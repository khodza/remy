import { DeleteTaskUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import { FailedToUpdateTaskError } from '@domain/task/errors';

describe('DeleteTaskUsecase', () => {
  let usecase: DeleteTaskUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  beforeEach(() => {
    taskRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findPendingReminders: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    usecase = new DeleteTaskUsecase(taskRepository);
  });

  it('should soft-delete a task by setting status to Deleted', async () => {
    taskRepository.update.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      telegramChatId: 12345,
      description: 'Buy groceries',
      scheduledAt: now,
      status: TaskStatus.Deleted,
      createdAt: now,
      updatedAt: now,
    });

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Deleted,
    });
    expect(result).toEqual({ success: true });
  });

  it('should wrap unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.update.mockRejectedValue(new Error('db error'));

    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toThrow(
      FailedToUpdateTaskError,
    );
  });
});
