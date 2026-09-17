import { ProcessTextMessageUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import type { TaskParserGateway } from '@domain/ai/gateway/task-parser';
import { InvalidInputError } from '@common/errors';
import { FailedToCreateTaskError } from '@domain/task/errors';
import { ParsingFailedError } from '@domain/ai/errors';

import { makeTask, mockTaskRepository } from '@test/factories';

describe('ProcessTextMessageUsecase', () => {
  let usecase: ProcessTextMessageUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;
  let taskParserGateway: jest.Mocked<TaskParserGateway>;

  const scheduledAt = new Date('2026-04-16T15:00:00Z');

  const mockTask = makeTask({ scheduledAt });

  beforeEach(() => {
    taskRepository = mockTaskRepository();

    taskParserGateway = {
      parse: jest.fn(),
    };

    usecase = new ProcessTextMessageUsecase(taskRepository, taskParserGateway);
  });

  it('should parse text and create a task', async () => {
    taskParserGateway.parse.mockResolvedValue({
      description: 'Buy groceries',
      scheduledAt,
      recurrence: null,
    });
    taskRepository.create.mockResolvedValue(mockTask);

    const result = await usecase.execute({
      userId: 'user-1',
      telegramChatId: 12345,
      text: 'Buy groceries at 3pm',
      userTimezone: 'UTC',
    });

    expect(taskParserGateway.parse).toHaveBeenCalledWith({
      text: 'Buy groceries at 3pm',
      userTimezone: 'UTC',
    });
    expect(taskRepository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      telegramChatId: 12345,
      description: 'Buy groceries',
      scheduledAt,
      timezone: 'UTC',
      recurrence: null,
    });
    expect(result).toEqual({
      taskId: 'task-1',
      description: 'Buy groceries',
      scheduledAt,
      timezone: 'UTC',
      recurrence: null,
    });
  });

  it('stores the user timezone and anchors a recurrence at the first occurrence', async () => {
    taskParserGateway.parse.mockResolvedValue({
      description: 'Take vitamins',
      scheduledAt,
      recurrence: { type: 'daily' },
    });
    taskRepository.create.mockResolvedValue(
      makeTask({
        scheduledAt,
        timezone: 'Asia/Tashkent',
        recurrence: { type: 'daily', anchorAt: scheduledAt },
      }),
    );

    const result = await usecase.execute({
      userId: 'user-1',
      telegramChatId: 12345,
      text: 'take vitamins every day at 9',
      userTimezone: 'Asia/Tashkent',
    });

    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'Asia/Tashkent',
        recurrence: { type: 'daily', anchorAt: scheduledAt },
      }),
    );
    expect(result.timezone).toBe('Asia/Tashkent');
  });

  it('should throw InvalidInputError for empty text', async () => {
    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 12345,
        text: '',
      }),
    ).rejects.toThrow(InvalidInputError);

    expect(taskParserGateway.parse).not.toHaveBeenCalled();
  });

  it('should re-throw ApplicationError from parser', async () => {
    taskParserGateway.parse.mockRejectedValue(
      new ParsingFailedError('AI failed'),
    );

    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 12345,
        text: 'Buy groceries',
      }),
    ).rejects.toThrow(ParsingFailedError);
  });

  it('should wrap unexpected errors in FailedToCreateTaskError', async () => {
    taskParserGateway.parse.mockRejectedValue(new Error('network error'));

    await expect(
      usecase.execute({
        userId: 'user-1',
        telegramChatId: 12345,
        text: 'Buy groceries',
      }),
    ).rejects.toThrow(FailedToCreateTaskError);
  });
});
