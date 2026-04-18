import { ProcessTextMessageUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import type { TaskParserGateway } from '@domain/ai/gateway/task-parser';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import { FailedToCreateTaskError } from '@domain/task/errors';
import { ParsingFailedError } from '@domain/ai/errors';

describe('ProcessTextMessageUsecase', () => {
  let usecase: ProcessTextMessageUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;
  let taskParserGateway: jest.Mocked<TaskParserGateway>;

  const now = new Date('2026-04-16T12:00:00Z');
  const scheduledAt = new Date('2026-04-16T15:00:00Z');

  const mockTask = {
    id: 'task-1',
    userId: 'user-1',
    telegramChatId: 12345,
    description: 'Buy groceries',
    scheduledAt,
    status: TaskStatus.Pending,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    taskRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findPendingReminders: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

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
      recurrence: null,
    });
    expect(result).toEqual({
      taskId: 'task-1',
      description: 'Buy groceries',
      scheduledAt,
    });
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
