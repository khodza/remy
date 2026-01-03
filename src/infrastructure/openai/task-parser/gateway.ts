import { Injectable } from '@nestjs/common';
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

      // Convert current time to user's timezone if provided
      const userTimezone = input.userTimezone ?? 'UTC';
      const currentTimeInUserTz = formatInTimeZone(
        now,
        userTimezone,
        "yyyy-MM-dd'T'HH:mm:ssXXX",
      );

      const systemPrompt = `You are a task parser. Extract the task description and scheduled time from user messages.
Current time is ${currentTimeInUserTz} (${userTimezone} timezone).

Return JSON with:
{
  "description": "cleaned task description",
  "scheduledAt": "ISO 8601 datetime in ${userTimezone} timezone"
}

Important:
- Convert relative times (tomorrow, next week, in 2 hours) to absolute ISO datetime
- Use the current time (${currentTimeInUserTz}) for all calculations
- All times should be in ${userTimezone} timezone
- Extract only the task description, removing action words like "remind me to"
- Default to future times (if user says 3pm and it's 4pm, assume tomorrow at 3pm)
- Return ISO 8601 format with timezone offset (e.g., "2026-01-03T17:00:00+00:00")`;

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (content === undefined || content === null) {
        throw new Error('No response from OpenAI');
      }

      const parsed = JSON.parse(content);

      return {
        description: parsed.description,
        scheduledAt: parseISO(parsed.scheduledAt),
      };
    } catch (error) {
      throw new ParsingFailedError('Failed to parse task from text', error);
    }
  }
}
