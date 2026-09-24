import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { SpeechGateway } from '@domain/ai/gateway/speech';
import type { SpeechInput, SpeechOutput } from '@domain/ai/gateway/speech';
import { SpeechSynthesisFailedError } from '@domain/ai/errors';
import { getEnv } from '@common/config';

/** OpenAI caps TTS input at 4096 characters. */
export const SPEECH_INPUT_MAX = 4000;
const VOICE = 'alloy';
const INSTRUCTIONS =
  'A friendly, unhurried personal assistant reading the morning plan. Read clock times as times of day.';

@Injectable()
export class SpeechGatewayImpl implements SpeechGateway {
  private readonly client: OpenAI;

  constructor() {
    // A brief is a paragraph; the SDK default (10 min, 2 retries) would
    // hold the digest run for ages when OpenAI is slow.
    this.client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    });
  }

  public async synthesize(input: SpeechInput): Promise<SpeechOutput> {
    const model = getEnv().OPENAI_TTS_MODEL;
    try {
      const response = await this.client.audio.speech.create({
        model,
        voice: VOICE,
        input: input.text.slice(0, SPEECH_INPUT_MAX),
        // Telegram plays OGG/Opus as a voice message (a waveform bubble).
        response_format: 'opus',
        // tts-1 / tts-1-hd reject `instructions`; the gpt-4o family takes them.
        ...(model.startsWith('gpt-') ? { instructions: INSTRUCTIONS } : {}),
      });
      return {
        audio: Buffer.from(await response.arrayBuffer()),
        mimeType: 'audio/ogg',
      };
    } catch (error) {
      throw new SpeechSynthesisFailedError(
        'Failed to synthesize speech',
        error,
      );
    }
  }
}
