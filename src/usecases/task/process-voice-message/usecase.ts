import { Injectable, Inject } from '@nestjs/common';
import { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import { Domain } from '@common/tokens';
import { ProcessVoiceMessageInput, ProcessVoiceMessageOutput } from './types';
import { ProcessTextMessageUsecase } from '../process-text-message';
import { ApplicationError } from '@domain/error';
import { TranscriptionFailedError } from '@domain/ai/errors';

@Injectable()
export class ProcessVoiceMessageUsecase {
  constructor(
    @Inject(Domain.AI.TranscriptionGateway)
    private readonly transcriptionGateway: TranscriptionGateway,
    private readonly processTextMessageUsecase: ProcessTextMessageUsecase,
  ) {}

  public async execute(
    input: ProcessVoiceMessageInput,
  ): Promise<ProcessVoiceMessageOutput> {
    let transcription;
    try {
      transcription = await this.transcriptionGateway.transcribe({
        audioFileBuffer: input.audioFileBuffer,
        mimeType: input.mimeType,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new TranscriptionFailedError(
        'Failed to transcribe voice message',
        error,
      );
    }

    // Anything after transcription (parsing, saving) reports its own error
    // type; wrapping it as a transcription failure misled the API client.
    const result = await this.processTextMessageUsecase.execute({
      userId: input.userId,
      telegramChatId: input.telegramChatId,
      text: transcription.text,
      userTimezone: input.userTimezone,
    });

    return {
      ...result,
      transcribedText: transcription.text,
    };
  }
}
