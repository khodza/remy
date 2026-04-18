import { ProcessVoiceMessageUsecase } from './usecase';
import type { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import { ProcessTextMessageUsecase } from '../process-text-message';
import { TranscriptionFailedError } from '@domain/ai/errors';

describe('ProcessVoiceMessageUsecase', () => {
  let usecase: ProcessVoiceMessageUsecase;
  let transcriptionGateway: jest.Mocked<TranscriptionGateway>;
  let processTextMessageUsecase: jest.Mocked<
    Pick<ProcessTextMessageUsecase, 'execute'>
  >;

  const scheduledAt = new Date('2026-04-16T15:00:00Z');

  beforeEach(() => {
    transcriptionGateway = {
      transcribe: jest.fn(),
    };

    processTextMessageUsecase = {
      execute: jest.fn(),
    };

    usecase = new ProcessVoiceMessageUsecase(
      transcriptionGateway,
      processTextMessageUsecase as unknown as ProcessTextMessageUsecase,
    );
  });

  it('should transcribe audio and process as text', async () => {
    transcriptionGateway.transcribe.mockResolvedValue({
      text: 'Buy groceries at 3pm',
    });
    processTextMessageUsecase.execute.mockResolvedValue({
      taskId: 'task-1',
      description: 'Buy groceries',
      scheduledAt,
    });

    const result = await usecase.execute({
      userId: 'user-1',
      telegramChatId: 12345,
      audioFileBuffer: Buffer.from('audio-data'),
      mimeType: 'audio/ogg',
      userTimezone: 'UTC',
    });

    expect(transcriptionGateway.transcribe).toHaveBeenCalledWith({
      audioFileBuffer: Buffer.from('audio-data'),
      mimeType: 'audio/ogg',
    });
    expect(processTextMessageUsecase.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      telegramChatId: 12345,
      text: 'Buy groceries at 3pm',
      userTimezone: 'UTC',
    });
    expect(result).toEqual({
      taskId: 'task-1',
      description: 'Buy groceries',
      scheduledAt,
      transcribedText: 'Buy groceries at 3pm',
    });
  });

  it('should re-throw ApplicationError from transcription', async () => {
    transcriptionGateway.transcribe.mockRejectedValue(
      new TranscriptionFailedError('Whisper failed'),
    );

    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 12345,
        audioFileBuffer: Buffer.from('bad-data'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow(TranscriptionFailedError);
  });

  it('should wrap unexpected errors in TranscriptionFailedError', async () => {
    transcriptionGateway.transcribe.mockRejectedValue(
      new Error('network error'),
    );

    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 12345,
        audioFileBuffer: Buffer.from('data'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow(TranscriptionFailedError);
  });
});
