import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { TaskParserGateway } from '@domain/ai/gateway/task-parser';
import {
  TaskParserInput,
  TaskParserOutput,
} from '@domain/ai/gateway/task-parser/types';
import { ParsingFailedError } from '@domain/ai/errors';
import { parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

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

      const { description, scheduledAt } = parsed as {
        description: string;
        scheduledAt: string;
      };

      const scheduledDate = parseISO(scheduledAt);
      this.logger.debug(
        `parsed "${input.text}" @ ${currentTimeInUserTz} → "${description}" @ ${scheduledAt}`,
      );

      return {
        description,
        scheduledAt: scheduledDate,
      };
    } catch (error) {
      throw new ParsingFailedError('Failed to parse task from text', error);
    }
  }
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
Return a single JSON object with two fields:
{
  "description": "<reminder text with action words like 'remind me to' stripped>",
  "scheduledAt": "<ISO 8601 datetime in ${userTimezone}, with offset ${currentOffset}>"
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

WORKED EXAMPLES (assume current time ${currentTimeInUserTz})
- "Call mom after 30 mins"
  → scheduledAt = currentTime + 30 minutes, same offset
- "Buy milk in 2 hours"
  → scheduledAt = currentTime + 2 hours, same offset
- "Pick up laundry at 6pm"
  → scheduledAt = today at 18:00:00${currentOffset} (or tomorrow if past 18:00)
- "Remind me tomorrow about the meeting"
  → scheduledAt = tomorrow at 09:00:00${currentOffset}
- "Pay rent next Friday at 5pm"
  → scheduledAt = upcoming Friday at 17:00:00${currentOffset}

Do the arithmetic carefully. Show no reasoning — return only the JSON object.`;
}
