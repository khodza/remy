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
          ...exchangeMessages(input),
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
          // While a question is open the request is the whole exchange: the
          // task may be named in the first message and only a time in this one.
          text: exchangeMessages(input)
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .join('\n'),
          contextTaskIds: [...input.replyToTaskIds, ...input.lastTaskIds],
          timezone: input.timezone,
          now: input.now,
          candidates: candidatesForPrompt(input),
          categories: input.categories,
        },
      );
      // Never the user's words in the log (B21): length and outcome only.
      this.logger.debug(
        `interpreted ${input.text.length} chars → ${interpretation.intent}`,
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

type ExchangeMessage = { role: 'user' | 'assistant'; content: string };

/**
 * The message as the model sees it. An answer to Remy's question is sent
 * with the exchange before it, as real chat turns: given only "17:00" the
 * model treats it as a new request ("a time with no task") and asks again.
 */
function exchangeMessages(input: InterpreterInput): ExchangeMessage[] {
  const pending = input.pendingQuestion;
  if (!pending) return [{ role: 'user', content: input.text }];
  return [
    { role: 'user', content: pending.originalText },
    ...pending.answered.flatMap((a): ExchangeMessage[] => [
      { role: 'assistant', content: a.question },
      { role: 'user', content: a.answer },
    ]),
    { role: 'assistant', content: pending.question },
    { role: 'user', content: input.text },
  ];
}
