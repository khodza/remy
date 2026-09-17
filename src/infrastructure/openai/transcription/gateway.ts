import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import {
  TranscriptionInput,
  TranscriptionOutput,
} from '@domain/ai/gateway/transcription/types';
import { TranscriptionFailedError } from '@domain/ai/errors';
import { getEnv } from '@common/config';

@Injectable()
export class TranscriptionGatewayImpl implements TranscriptionGateway {
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY });
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
