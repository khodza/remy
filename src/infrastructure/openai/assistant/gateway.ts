import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { getEnv } from '@common/config';
import type {
  Interpretation,
  InterpreterGateway,
  InterpreterInput,
} from '@domain/assistant';
import { InterpretationFailedError } from '@domain/assistant';
import { ASSISTANT_OUTPUT_SCHEMA } from './schema';
import { buildAssistantPrompt, candidatesForPrompt } from './prompt';
import { interpretAssistantOutput } from './interpret-output';

@Injectable()
export class InterpreterGatewayImpl implements InterpreterGateway {
  private readonly logger = new Logger(InterpreterGatewayImpl.name);
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    });
  }

  public async interpret(input: InterpreterInput): Promise<Interpretation> {
    try {
      const response = await this.client.chat.completions.create({
        model: getEnv().OPENAI_ASSISTANT_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: buildAssistantPrompt(input) },
          { role: 'user', content: input.text },
        ],
        // Strict structured outputs: the reply always matches the schema, so
        // there is no "model returned prose" failure mode.
        response_format: {
          type: 'json_schema',
          json_schema: ASSISTANT_OUTPUT_SCHEMA,
        },
      });

      const message = response.choices[0]?.message;
      if (message?.refusal) {
        return { intent: 'chat', reply: "Sorry, I can't help with that." };
      }
      if (!message?.content) throw new Error('Empty response from OpenAI');

      if (process.env['ASSISTANT_DEBUG'] === '1') {
        this.logger.debug(`raw model output: ${message.content}`);
      }
      const interpretation = interpretAssistantOutput(
        JSON.parse(message.content),
        {
          text: input.text,
          contextTaskIds: [...input.replyToTaskIds, ...input.lastTaskIds],
          timezone: input.timezone,
          now: input.now,
          candidates: candidatesForPrompt(input),
          categories: input.categories,
        },
      );
      this.logger.debug(
        `"${input.text.slice(0, 80)}" → ${interpretation.intent}`,
      );
      return interpretation;
    } catch (error) {
      throw new InterpretationFailedError(
        'Failed to interpret the message',
        error,
      );
    }
  }
}
