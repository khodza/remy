import { DelayTaskUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import {
  TaskNotFoundError,
  FailedToUpdateTaskError,
} from '@domain/task/errors';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('DelayTaskUsecase', () => {
  let usecase: DelayTaskUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T12:00:00Z');
  const scheduledAt = new Date('2026-04-16T14:00:00Z');
  const mockTask = makeTask({ scheduledAt });

  beforeEach(() => {
    taskRepository = mockTaskRepository();
    usecase = new DelayTaskUsecase(taskRepository);
    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('moves a one-shot task by the given minutes', async () => {
    taskRepository.findById.mockResolvedValue(mockTask);
    taskRepository.update.mockImplementation(async (p) =>
      makeTask({ scheduledAt: p.scheduledAt }),
    );

    const result = await usecase.execute({
      taskId: 'task-1',
      delayMinutes: 30,
    });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-04-16T14:30:00Z'),
      snoozedUntil: null,
      incrementSnoozeCount: true,
    });
    expect(result.scheduledAt).toEqual(new Date('2026-04-16T14:30:00Z'));
  });

  it('delays an overdue task from now, not from its old time', async () => {
    const overdue = makeTask({ scheduledAt: new Date('2026-04-16T09:00:00Z') });
    taskRepository.findById.mockResolvedValue(overdue);
    taskRepository.update.mockResolvedValue(overdue);

    await usecase.execute({ taskId: 'task-1', delayMinutes: 15 });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-04-16T12:15:00Z'),
      snoozedUntil: null,
      incrementSnoozeCount: true,
    });
  });

  it('counts from the due time, not from a pending nudge or heads-up', async () => {
    // Fired at 12:00 a minute ago; the next ping is the 12:30 nudge.
    const nudging = makeTask({
      scheduledAt: new Date('2026-04-16T11:59:00Z'),
      nextFireAt: new Date('2026-04-16T12:30:00Z'),
    });
    taskRepository.findById.mockResolvedValue(nudging);
    taskRepository.update.mockResolvedValue(nudging);
    await usecase.execute({ taskId: 'task-1', delayMinutes: 15 });
    expect(taskRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-04-16T12:15:00Z'),
      }),
    );

    // Due 15:00 with the heads-up pending at 14:00: +15m is 15:15, not 14:15.
    const headsUp = makeTask({
      scheduledAt: new Date('2026-04-16T15:00:00Z'),
      nextFireAt: new Date('2026-04-16T14:00:00Z'),
    });
    taskRepository.findById.mockResolvedValue(headsUp);
    await usecase.execute({ taskId: 'task-1', delayMinutes: 15 });
    expect(taskRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-04-16T15:15:00Z'),
      }),
    );
  });

  it('snoozes only the current occurrence of a recurring task', async () => {
    const daily = makeTask({
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      recurrence: { type: 'daily' },
    });
    taskRepository.findById.mockResolvedValue(daily);
    taskRepository.update.mockResolvedValue(daily);

    await usecase.execute({ taskId: 'task-1', delayMinutes: 60 });

    // Series time untouched; the reminder fires an hour from now.
    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      snoozedUntil: new Date('2026-04-16T13:00:00Z'),
      incrementSnoozeCount: true,
    });
  });

  it('snoozes an already-snoozed recurring task from its current fire time', async () => {
    const daily = makeTask({
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      snoozedUntil: new Date('2026-04-16T14:00:00Z'),
      recurrence: { type: 'daily' },
    });
    taskRepository.findById.mockResolvedValue(daily);
    taskRepository.update.mockResolvedValue(daily);

    await usecase.execute({ taskId: 'task-1', delayMinutes: 15 });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      snoozedUntil: new Date('2026-04-16T14:15:00Z'),
      incrementSnoozeCount: true,
    });
  });

  it('refuses to delay a completed task', async () => {
    taskRepository.findById.mockResolvedValue(
      makeTask({ status: TaskStatus.Completed }),
    );
    await expect(
      usecase.execute({ taskId: 'task-1', delayMinutes: 15 }),
    ).rejects.toThrow(InvalidInputError);
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('throws InvalidInputError for invalid delay', async () => {
    await expect(
      usecase.execute({ taskId: 'task-1', delayMinutes: -5 }),
    ).rejects.toThrow(InvalidInputError);
    expect(taskRepository.findById).not.toHaveBeenCalled();
  });

  it('throws TaskNotFoundError when task does not exist', async () => {
    taskRepository.findById.mockResolvedValue(null);
    await expect(
      usecase.execute({ taskId: 'nonexistent', delayMinutes: 15 }),
    ).rejects.toThrow(TaskNotFoundError);
  });

  it('wraps unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.findById.mockRejectedValue(new Error('db error'));
    await expect(
      usecase.execute({ taskId: 'task-1', delayMinutes: 15 }),
    ).rejects.toThrow(FailedToUpdateTaskError);
  });
});
