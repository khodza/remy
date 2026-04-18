import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { TaskParserGateway } from '@domain/ai/gateway/task-parser';
import {
  TaskParserInput,
  TaskParserOutput,
} from '@domain/ai/gateway/task-parser/types';
import { ParsingFailedError } from '@domain/ai/errors';
import type { Recurrence, RecurrenceType } from '@domain/task';
import { parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

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
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined');
    }
    this.client = new OpenAI({ apiKey, fetch: fetch as any });
  }

  public async parse(input: TaskParserInput): Promise<TaskParserOutput> {
    try {
      const now = new Date();
      const userTimezone = input.userTimezone ?? 'UTC';
      const currentTimeInUserTz = formatInTimeZone(
        now,
        userTimezone,
        "yyyy-MM-dd'T'HH:mm:ssXXX",
      );
      const currentOffset = formatInTimeZone(now, userTimezone, 'XXX');
      const weekday = formatInTimeZone(now, userTimezone, 'EEEE');
      const dateISO = formatInTimeZone(now, userTimezone, 'yyyy-MM-dd');

      const systemPrompt = buildSystemPrompt({
        currentTimeInUserTz,
        currentOffset,
        userTimezone,
        weekday,
        dateISO,
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

      const parsed: unknown = JSON.parse(content);

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('description' in parsed) ||
        !('scheduledAt' in parsed) ||
        typeof (parsed as Record<string, unknown>)['description'] !== 'string' ||
        typeof (parsed as Record<string, unknown>)['scheduledAt'] !== 'string'
      ) {
        throw new Error('Invalid response format from OpenAI');
      }

      const obj = parsed as Record<string, unknown>;
      const description = obj['description'] as string;
      const scheduledAt = obj['scheduledAt'] as string;
      const recurrence = extractRecurrence(obj['recurrence']);

      const scheduledDate = parseISO(scheduledAt);
      this.logger.debug(
        `parsed "${input.text}" @ ${currentTimeInUserTz} → "${description}" @ ${scheduledAt} recurrence=${JSON.stringify(recurrence)}`,
      );

      return {
        description,
        scheduledAt: scheduledDate,
        recurrence,
      };
    } catch (error) {
      throw new ParsingFailedError('Failed to parse task from text', error);
    }
  }
}

function extractRecurrence(value: unknown): Recurrence | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const type = obj['type'];
  if (typeof type !== 'string') return null;
  if (!RECURRENCE_TYPES.includes(type as RecurrenceType)) return null;

  const recurrence: Recurrence = { type: type as RecurrenceType };
  const interval = obj['intervalDays'];
  if (typeof interval === 'number' && Number.isFinite(interval) && interval >= 1) {
    recurrence.intervalDays = Math.floor(interval);
  }
  if (recurrence.type === 'every_n_days' && recurrence.intervalDays === undefined) {
    // Model asked for interval recurrence without telling us how often —
    // default to 1 so the task still works.
    recurrence.intervalDays = 1;
  }
  return recurrence;
}

function buildSystemPrompt(args: {
  currentTimeInUserTz: string;
  currentOffset: string;
  userTimezone: string;
  weekday: string;
  dateISO: string;
}): string {
  const { currentTimeInUserTz, currentOffset, userTimezone, weekday, dateISO } =
    args;

  return `You convert a user's natural-language reminder request into JSON.

CONTEXT
- Current local time: ${currentTimeInUserTz} (${weekday}, ${dateISO})
- User timezone: ${userTimezone}
- Timezone offset: ${currentOffset}

OUTPUT
Return a single JSON object with these fields:
{
  "description": "<reminder text with action words like 'remind me to' stripped>",
  "scheduledAt": "<ISO 8601 datetime in ${userTimezone}, with offset ${currentOffset}>",
  "recurrence": null OR {
    "type": "daily" | "weekdays" | "weekly" | "monthly" | "every_n_days",
    "intervalDays": <positive integer, ONLY when type is "every_n_days">
  }
}

RULES for scheduledAt
1. RELATIVE durations ("in X minutes/hours/days", "after 30 mins", "in 2 hours"):
   ADD the exact duration to the current local time. Do not round.
2. ABSOLUTE times ("at 3pm", "at 17:00"): use that time TODAY if still in the
   future, otherwise TOMORROW.
3. RELATIVE dates ("tomorrow", "next Monday", "this weekend"): keep any time
   of day the user specified; otherwise default to 09:00.
4. Always use offset ${currentOffset} in the output.
5. scheduledAt must be strictly in the future relative to the current local time.

RULES for recurrence
- "every day", "daily", "each day" → {"type": "daily"}
- "every weekday", "on weekdays", "Mon-Fri", "each weekday" → {"type": "weekdays"}
- "every week", "weekly", "every Monday/Tuesday/..." → {"type": "weekly"}
- "every month", "monthly", "the 1st of each month" → {"type": "monthly"}
- "every 3 days", "every N days" (N > 1) → {"type": "every_n_days", "intervalDays": N}
- Otherwise → null
- scheduledAt is the FIRST occurrence; the client advances subsequent dates.

WORKED EXAMPLES (assume current time ${currentTimeInUserTz})
- "Call mom after 30 mins"
  → scheduledAt = currentTime + 30 minutes, recurrence = null
- "Buy milk in 2 hours"
  → scheduledAt = currentTime + 2 hours, recurrence = null
- "Pick up laundry at 6pm"
  → scheduledAt = today at 18:00:00${currentOffset}, recurrence = null
- "Stand-up every weekday at 9am"
  → scheduledAt = next weekday at 09:00:00${currentOffset},
    recurrence = {"type": "weekdays"}
- "Water plants every 3 days"
  → scheduledAt = tomorrow at 09:00:00${currentOffset},
    recurrence = {"type": "every_n_days", "intervalDays": 3}
- "Take meds daily at 8am"
  → scheduledAt = next 08:00:00${currentOffset},
    recurrence = {"type": "daily"}

Do the arithmetic carefully. Show no reasoning — return only the JSON object.`;
}
