import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import {
  TranscriptionInput,
  TranscriptionOutput,
} from '@domain/ai/gateway/transcription/types';
import { TranscriptionFailedError } from '@domain/ai/errors';

@Injectable()
export class TranscriptionGatewayImpl implements TranscriptionGateway {
  private readonly client: OpenAI;

  constructor() {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined');
    }
    // Use default fetch (native in Node.js 18+)
    this.client = new OpenAI({ apiKey });
  }

  public async transcribe(
    input: TranscriptionInput,
  ): Promise<TranscriptionOutput> {
    try {
      // Use toFile helper for Node.js compatibility
      const file = await OpenAI.toFile(input.audioFileBuffer, 'voice.ogg', {
        type: input.mimeType,
      });

      const response = await this.client.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
      });

      return {
        text: response.text,
      };
    } catch (error) {
      throw new TranscriptionFailedError('Failed to transcribe audio', error);
    }
  }
}
