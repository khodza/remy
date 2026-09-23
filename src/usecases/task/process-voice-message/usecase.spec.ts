import { ProcessVoiceMessageUsecase } from './usecase';
import type { TranscriptionGateway } from '@domain/ai/gateway/transcription';
import { ProcessTextMessageUsecase } from '../process-text-message';
import { TranscriptionFailedError } from '@domain/ai/errors';
import { NotATaskError } from '@domain/assistant';
import { makeTask } from '@test/factories';

describe('ProcessVoiceMessageUsecase', () => {
  let usecase: ProcessVoiceMessageUsecase;
  let transcriptionGateway: jest.Mocked<TranscriptionGateway>;
  let processText: jest.Mocked<Pick<ProcessTextMessageUsecase, 'execute'>>;

  const input = {
    userId: 'user-1',
    telegramChatId: 12345,
    audioFileBuffer: Buffer.from('audio-data'),
    mimeType: 'audio/ogg',
    timezone: 'UTC',
  };

  beforeEach(() => {
    transcriptionGateway = { transcribe: jest.fn() };
    processText = { execute: jest.fn() };
    usecase = new ProcessVoiceMessageUsecase(
      transcriptionGateway,
      processText as unknown as ProcessTextMessageUsecase,
    );
  });

  it('transcribes, then reads the transcript like typed text', async () => {
    transcriptionGateway.transcribe.mockResolvedValue({
      text: 'Buy groceries at 3pm',
    });
    const task = makeTask();
    processText.execute.mockResolvedValue({ tasks: [task] });

    const result = await usecase.execute(input);

    expect(transcriptionGateway.transcribe).toHaveBeenCalledWith({
      audioFileBuffer: Buffer.from('audio-data'),
      mimeType: 'audio/ogg',
    });
    expect(processText.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      telegramChatId: 12345,
      text: 'Buy groceries at 3pm',
      timezone: 'UTC',
      sourceType: 'miniapp',
    });
    expect(result).toEqual({
      tasks: [task],
      transcribedText: 'Buy groceries at 3pm',
    });
  });

  it('a silent recording is not a task (nothing is parsed)', async () => {
    transcriptionGateway.transcribe.mockResolvedValue({ text: '  ' });
    await expect(usecase.execute(input)).rejects.toBeInstanceOf(NotATaskError);
    expect(processText.execute).not.toHaveBeenCalled();
  });

  it('wraps transcription failures, but not what comes after', async () => {
    transcriptionGateway.transcribe.mockRejectedValue(new Error('network'));
    await expect(usecase.execute(input)).rejects.toBeInstanceOf(
      TranscriptionFailedError,
    );
    transcriptionGateway.transcribe.mockResolvedValue({ text: 'hi' });
    processText.execute.mockRejectedValue(new NotATaskError('nope'));
    await expect(usecase.execute(input)).rejects.toBeInstanceOf(NotATaskError);
  });
});
