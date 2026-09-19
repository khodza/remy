import { Inject, Injectable } from '@nestjs/common';
import type { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import { TranscriptionFailedError } from '@domain/ai/errors';
import { ApplicationError } from '@domain/error';
import { InvalidInputError } from '@common/errors';
import { Domain } from '@common/tokens';

/** Voice note → text, so it can go through the same assistant as typed messages. */
@Injectable()
export class TranscribeAudioUsecase {
  constructor(
    @Inject(Domain.AI.TranscriptionGateway)
    private readonly transcription: TranscriptionGateway,
  ) {}

  public async execute(input: {
    audio: Buffer;
    mimeType: string;
  }): Promise<{ text: string }> {
    try {
      const { text } = await this.transcription.transcribe({
        audioFileBuffer: input.audio,
        mimeType: input.mimeType,
      });
      const trimmed = text.trim();
      if (trimmed === '')
        throw new InvalidInputError('Nothing was said in the recording');
      return { text: trimmed };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new TranscriptionFailedError(
        'Failed to transcribe voice message',
        error,
      );
    }
  }
}
