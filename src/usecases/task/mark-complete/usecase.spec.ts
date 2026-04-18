import { MarkCompleteUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import { FailedToUpdateTaskError } from '@domain/task/errors';

describe('MarkCompleteUsecase', () => {
  let usecase: MarkCompleteUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  const completedTask = {
    id: 'task-1',
    userId: 'user-1',
    telegramChatId: 12345,
    description: 'Buy groceries',
    scheduledAt: now,
    status: TaskStatus.Completed,
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

    usecase = new MarkCompleteUsecase(taskRepository);
  });

  it('should mark a task as completed', async () => {
    taskRepository.update.mockResolvedValue(completedTask);

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Completed,
    });
    expect(result.status).toBe(TaskStatus.Completed);
  });

  it('should wrap unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.update.mockRejectedValue(new Error('db error'));

    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toThrow(
      FailedToUpdateTaskError,
    );
  });
});
