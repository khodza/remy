import { MarkCompleteUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import type { Task } from '@domain/task';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';

describe('MarkCompleteUsecase', () => {
  let usecase: MarkCompleteUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');

  const baseTask: Task = {
    id: 'task-1',
    userId: 'user-1',
    telegramChatId: 12345,
    description: 'Buy groceries',
    scheduledAt: now,
    status: TaskStatus.Pending,
    recurrence: null,
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

  it('marks a one-shot task as completed', async () => {
    taskRepository.findById.mockResolvedValue(baseTask);
    taskRepository.update.mockResolvedValue({
      ...baseTask,
      status: TaskStatus.Completed,
    });

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Completed,
    });
    expect(result.status).toBe(TaskStatus.Completed);
  });

  it('advances scheduledAt by 1 day for a daily recurring task', async () => {
    const dailyTask: Task = {
      ...baseTask,
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      recurrence: { type: 'daily' },
    };
    taskRepository.findById.mockResolvedValue(dailyTask);
    taskRepository.update.mockImplementation(async ({ scheduledAt }) => ({
      ...dailyTask,
      scheduledAt: scheduledAt ?? dailyTask.scheduledAt,
    }));

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-16T10:00:00Z'));

    await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-04-17T09:00:00Z'),
      status: TaskStatus.Pending,
    });

    jest.useRealTimers();
  });

  it('advances past missed cycles so the next fire is in the future', async () => {
    const weeklyTask: Task = {
      ...baseTask,
      scheduledAt: new Date('2026-04-01T09:00:00Z'), // three weeks ago relative to "now"
      recurrence: { type: 'weekly' },
    };
    taskRepository.findById.mockResolvedValue(weeklyTask);
    taskRepository.update.mockImplementation(async ({ scheduledAt }) => ({
      ...weeklyTask,
      scheduledAt: scheduledAt ?? weeklyTask.scheduledAt,
    }));

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-22T10:00:00Z'));

    await usecase.execute({ taskId: 'task-1' });

    const called = taskRepository.update.mock.calls[0]?.[0];
    expect(called?.scheduledAt).toBeDefined();
    expect(called?.scheduledAt!.getTime()).toBeGreaterThan(
      new Date('2026-04-22T10:00:00Z').getTime(),
    );

    jest.useRealTimers();
  });

  it('throws TaskNotFoundError when the task does not exist', async () => {
    taskRepository.findById.mockResolvedValue(null);
    await expect(usecase.execute({ taskId: 'missing' })).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });

  it('wraps unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.findById.mockResolvedValue(baseTask);
    taskRepository.update.mockRejectedValue(new Error('db error'));

    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toBeInstanceOf(
      FailedToUpdateTaskError,
    );
  });
});
