import { Injectable, Inject } from '@nestjs/common';
import { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import { Domain } from '@common/tokens';
import { ProcessVoiceMessageInput, ProcessVoiceMessageOutput } from './types';
import { ProcessTextMessageUsecase } from '../process-text-message';
import { ApplicationError } from '@domain/error';
import { TranscriptionFailedError } from '@domain/ai/errors';
import { NotATaskError } from '@domain/assistant';

const NOTHING_HEARD =
  'I could not hear a reminder in that recording. Try again, a little closer to the mic.';

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
    // Silence transcribes to nothing; that is not a request.
    if (transcription.text.trim() === '')
      throw new NotATaskError(NOTHING_HEARD);

    // Anything after transcription (parsing, saving) reports its own error
    // type; wrapping it as a transcription failure misled the API client.
    const result = await this.processTextMessageUsecase.execute({
      userId: input.userId,
      telegramChatId: input.telegramChatId,
      text: transcription.text,
      timezone: input.timezone,
      sourceType: input.sourceType ?? 'miniapp',
    });

    return { ...result, transcribedText: transcription.text };
  }
}
