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
    // A voice note should transcribe in seconds; the SDK default (10 min,
    // 2 retries) would hold a reminder run or a Mini App request for ages.
    this.client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    });
  }

  public async transcribe(
    input: TranscriptionInput,
  ): Promise<TranscriptionOutput> {
    try {
      // OpenAI infers the container from the file name, so it must match
      // the bytes: Telegram sends ogg/opus, the Mini App webm or m4a.
      const file = await OpenAI.toFile(
        input.audioFileBuffer,
        `voice.${extensionForMime(input.mimeType)}`,
        { type: input.mimeType },
      );

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

export function extensionForMime(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (base) {
    case 'audio/webm':
    case 'video/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/flac':
      return 'flac';
    case 'audio/ogg':
    case 'audio/opus':
    default:
      return 'ogg';
  }
}
