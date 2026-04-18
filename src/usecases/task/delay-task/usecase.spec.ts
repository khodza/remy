import { DelayTaskUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import { TaskNotFoundError, FailedToUpdateTaskError } from '@domain/task/errors';
import { addMinutes } from 'date-fns';

describe('DelayTaskUsecase', () => {
  let usecase: DelayTaskUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');
  const scheduledAt = new Date('2026-04-16T14:00:00Z');

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

    usecase = new DelayTaskUsecase(taskRepository);
  });

  it('should delay a task by the given minutes', async () => {
    const delayMinutes = 30;
    const newScheduledAt = addMinutes(scheduledAt, delayMinutes);

    taskRepository.findById.mockResolvedValue(mockTask);
    taskRepository.update.mockResolvedValue({
      ...mockTask,
      scheduledAt: newScheduledAt,
    });

    const result = await usecase.execute({
      taskId: 'task-1',
      delayMinutes,
    });

    expect(taskRepository.findById).toHaveBeenCalledWith('task-1');
    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: newScheduledAt,
    });
    expect(result.scheduledAt).toEqual(newScheduledAt);
  });

  it('should throw InvalidInputError for invalid delay', async () => {
    await expect(
      usecase.execute({ taskId: 'task-1', delayMinutes: -5 }),
    ).rejects.toThrow(InvalidInputError);

    expect(taskRepository.findById).not.toHaveBeenCalled();
  });

  it('should throw TaskNotFoundError when task does not exist', async () => {
    taskRepository.findById.mockResolvedValue(null);

    await expect(
      usecase.execute({ taskId: 'nonexistent', delayMinutes: 15 }),
    ).rejects.toThrow(TaskNotFoundError);
  });

  it('should wrap unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.findById.mockRejectedValue(new Error('db error'));

    await expect(
      usecase.execute({ taskId: 'task-1', delayMinutes: 15 }),
    ).rejects.toThrow(FailedToUpdateTaskError);
  });
});
