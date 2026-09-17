import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { getEnv } from '@common/config';
import { TaskParserGateway } from '@domain/ai/gateway/task-parser';
import {
  TaskParserInput,
  TaskParserOutput,
} from '@domain/ai/gateway/task-parser/types';
import { ParsingFailedError } from '@domain/ai/errors';
import type { Recurrence, RecurrenceType } from '@domain/task';
import { isValid, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const RECURRENCE_TYPES: RecurrenceType[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'every_n_days',
];

@Injectable()
export class TaskParserGatewayImpl implements TaskParserGateway {
  private readonly logger = new Logger(TaskParserGatewayImpl.name);
  private readonly client: OpenAI;

  constructor() {
    // Parsing is one short completion; don't let the SDK default (10 min,
    // 2 retries) stall a chat reply or a Mini App request.
    this.client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    });
  }

  public async parse(input: TaskParserInput): Promise<TaskParserOutput> {
    try {
      const now = new Date();
      const userTimezone = input.userTimezone ?? 'UTC';
      const nowLocal = formatInTimeZone(
        now,
        userTimezone,
        "yyyy-MM-dd'T'HH:mm:ss",
      );
      const weekday = formatInTimeZone(now, userTimezone, 'EEEE');

      const systemPrompt = buildSystemPrompt({
        nowLocal,
        userTimezone,
        weekday,
      });

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content;
      if (content === undefined || content === null) {
        throw new Error('No response from OpenAI');
      }

      const parsed = interpretModelOutput(JSON.parse(content), userTimezone);

      this.logger.debug(
        `parsed (${userTimezone}, now ${nowLocal}) → "${parsed.description}" @ ${parsed.scheduledAt.toISOString()} recurrence=${JSON.stringify(parsed.recurrence)}`,
      );

      return parsed;
    } catch (error) {
      throw new ParsingFailedError('Failed to parse task from text', error);
    }
  }
}

/**
 * Validates the model's JSON and converts its wall-clock time (in the
 * user's zone) into an absolute instant. The model never has to know
 * UTC offsets, which it gets wrong around DST switches.
 */
export function interpretModelOutput(
  raw: unknown,
  userTimezone: string,
): TaskParserOutput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Model output is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const description = obj['description'];
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('Model output has no description');
  }

  const local = obj['scheduledAtLocal'];
  const withOffset = obj['scheduledAt'];
  let scheduledAt: Date;
  if (typeof local === 'string') {
    scheduledAt = fromZonedTime(local, userTimezone);
  } else if (typeof withOffset === 'string') {
    // Fallback for older prompt outputs that included an offset.
    scheduledAt = parseISO(withOffset);
  } else {
    throw new Error('Model output has no scheduledAtLocal');
  }
  if (!isValid(scheduledAt)) {
    throw new Error(
      `Model output has an invalid time: ${String(local ?? withOffset)}`,
    );
  }

  return {
    description: description.trim(),
    scheduledAt,
    recurrence: extractRecurrence(obj['recurrence']),
  };
}

function extractRecurrence(value: unknown): Recurrence | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const type = obj['type'];
  if (typeof type !== 'string') return null;
  if (!RECURRENCE_TYPES.includes(type as RecurrenceType)) return null;

  const recurrence: Recurrence = { type: type as RecurrenceType };
  if (recurrence.type === 'every_n_days') {
    const interval = obj['intervalDays'];
    recurrence.intervalDays =
      typeof interval === 'number' && Number.isFinite(interval) && interval >= 1
        ? Math.floor(interval)
        : 1;
  }
  return recurrence;
}

function buildSystemPrompt(args: {
  nowLocal: string;
  userTimezone: string;
  weekday: string;
}): string {
  const { nowLocal, userTimezone, weekday } = args;

  return `You convert a user's natural-language reminder request into JSON.

CONTEXT
- Current local date and time: ${nowLocal} (${weekday})
- User timezone: ${userTimezone}
All times you output are LOCAL wall-clock times in that timezone. Never add
a UTC offset or a "Z"; the server converts.

OUTPUT
Return a single JSON object with these fields:
{
  "description": "<reminder text with action words like 'remind me to' stripped>",
  "scheduledAtLocal": "<YYYY-MM-DDTHH:mm:ss, local wall-clock time>",
  "recurrence": null OR {
    "type": "daily" | "weekdays" | "weekly" | "monthly" | "every_n_days",
    "intervalDays": <positive integer, ONLY when type is "every_n_days">
  }
}

RULES for scheduledAtLocal
1. RELATIVE durations ("in X minutes/hours/days", "after 30 mins", "in 2 hours"):
   ADD the exact duration to the current local time. Do not round.
2. ABSOLUTE times ("at 3pm", "at 17:00"): use that time TODAY if still in the
   future, otherwise TOMORROW. A bare hour like "at 5" with no am/pm means the
   next occurrence of 5 (morning or evening), whichever comes first and is in
   the future; if that is before 07:00 prefer the evening.
3. RELATIVE dates ("tomorrow", "next Monday", "this weekend"): keep any time
   of day the user specified; otherwise default to 09:00.
4. scheduledAtLocal must be strictly in the future relative to the current
   local time.

RULES for recurrence
- "every day", "daily", "each day" → {"type": "daily"}
- "every weekday", "on weekdays", "Mon-Fri", "each weekday" → {"type": "weekdays"}
- "every week", "weekly", "every Monday/Tuesday/..." → {"type": "weekly"}
- "every month", "monthly", "the 1st of each month" → {"type": "monthly"}
- "every 3 days", "every N days" (N > 1) → {"type": "every_n_days", "intervalDays": N}
- Otherwise → null
- scheduledAtLocal is the FIRST occurrence; the server advances subsequent dates.

WORKED EXAMPLES (assume current local time ${nowLocal})
- "Call mom after 30 mins"
  → scheduledAtLocal = current time + 30 minutes, recurrence = null
- "Buy milk in 2 hours"
  → scheduledAtLocal = current time + 2 hours, recurrence = null
- "Pick up laundry at 6pm"
  → scheduledAtLocal = today at 18:00:00 (or tomorrow if 18:00 has passed), recurrence = null
- "Stand-up every weekday at 9am"
  → scheduledAtLocal = next weekday at 09:00:00, recurrence = {"type": "weekdays"}
- "Water plants every 3 days"
  → scheduledAtLocal = tomorrow at 09:00:00, recurrence = {"type": "every_n_days", "intervalDays": 3}
- "Take meds daily at 8am"
  → scheduledAtLocal = next 08:00:00, recurrence = {"type": "daily"}

Do the arithmetic carefully. Show no reasoning — return only the JSON object.`;
}
