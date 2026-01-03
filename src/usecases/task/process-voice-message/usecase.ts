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
    try {
      // Transcribe voice message
      const transcription = await this.transcriptionGateway.transcribe({
        audioFileBuffer: input.audioFileBuffer,
        mimeType: input.mimeType,
      });

      // Process transcribed text
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
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new TranscriptionFailedError(
        'Failed to process voice message',
        error,
      );
    }
  }
}
