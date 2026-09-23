import { MarkCompleteUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import {
  FailedToUpdateTaskError,
  TaskNotFoundError,
} from '@domain/task/errors';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('MarkCompleteUsecase', () => {
  let usecase: MarkCompleteUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  const now = new Date('2026-04-16T10:00:00Z');

  beforeEach(() => {
    taskRepository = mockTaskRepository();
    usecase = new MarkCompleteUsecase(taskRepository);
    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks a one-shot task as completed', async () => {
    const task = makeTask();
    taskRepository.findById.mockResolvedValue(task);
    taskRepository.update.mockResolvedValue({
      ...task,
      status: TaskStatus.Completed,
    });

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Completed,
      completedAt: now,
    });
    expect(result.status).toBe(TaskStatus.Completed);
    expect(result.alreadyDone).toBe(false);
  });

  it('is a no-op on an already completed one-shot task', async () => {
    taskRepository.findById.mockResolvedValue(
      makeTask({ status: TaskStatus.Completed }),
    );
    const result = await usecase.execute({ taskId: 'task-1' });
    expect(result.alreadyDone).toBe(true);
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('advances a daily task by one day and clears its snooze', async () => {
    const daily = makeTask({
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      snoozedUntil: new Date('2026-04-16T09:45:00Z'),
      recurrence: { type: 'daily' },
    });
    taskRepository.findById.mockResolvedValue(daily);
    taskRepository.update.mockImplementation(async ({ scheduledAt }) =>
      makeTask({ ...daily, scheduledAt: scheduledAt ?? daily.scheduledAt }),
    );

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-04-17T09:00:00Z'),
      snoozedUntil: null,
      status: TaskStatus.Pending,
      // The completed occurrence is recorded in the task's history.
      pushCompletion: {
        at: now,
        occurrenceAt: new Date('2026-04-16T09:00:00Z'),
      },
    });
    expect(result.alreadyDone).toBe(false);
  });

  it('advances in the task timezone, keeping the wall-clock time across DST', async () => {
    // Berlin switches to summer time on 2026-03-29: 09:00 CET is 08:00Z,
    // 09:00 CEST is 07:00Z.
    const berlinDaily = makeTask({
      scheduledAt: new Date('2026-03-28T08:00:00Z'),
      timezone: 'Europe/Berlin',
      recurrence: { type: 'daily' },
    });
    jest.setSystemTime(new Date('2026-03-28T09:00:00Z'));
    taskRepository.findById.mockResolvedValue(berlinDaily);
    taskRepository.update.mockImplementation(async ({ scheduledAt }) =>
      makeTask({
        ...berlinDaily,
        scheduledAt: scheduledAt ?? berlinDaily.scheduledAt,
      }),
    );

    await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-03-29T07:00:00Z'),
      }),
    );
  });

  it('is idempotent: a recurring task already in the future is not advanced again', async () => {
    const advanced = makeTask({
      scheduledAt: new Date('2026-04-17T09:00:00Z'), // tomorrow, relative to now
      recurrence: { type: 'daily' },
    });
    taskRepository.findById.mockResolvedValue(advanced);

    const result = await usecase.execute({ taskId: 'task-1' });

    expect(result.alreadyDone).toBe(true);
    expect(result.scheduledAt).toEqual(advanced.scheduledAt);
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('Done on the heads-up (before the time) counts for that occurrence; a stale one does not', async () => {
    const tonight = makeTask({
      scheduledAt: new Date('2026-04-16T16:00:00Z'), // later today
      recurrence: { type: 'daily' },
    });
    taskRepository.findById.mockResolvedValue(tonight);
    taskRepository.update.mockResolvedValue(tonight);

    const result = await usecase.execute({
      taskId: 'task-1',
      occurrenceAt: new Date('2026-04-16T16:00:00Z'),
    });
    expect(result.alreadyDone).toBe(false);
    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-04-17T16:00:00Z'),
        pushCompletion: expect.objectContaining({
          occurrenceAt: new Date('2026-04-16T16:00:00Z'),
        }),
      }),
    );

    // The same button tapped again: the series has moved on, nothing happens.
    taskRepository.update.mockClear();
    taskRepository.findById.mockResolvedValue(
      makeTask({
        scheduledAt: new Date('2026-04-17T16:00:00Z'),
        recurrence: { type: 'daily' },
      }),
    );
    const again = await usecase.execute({
      taskId: 'task-1',
      occurrenceAt: new Date('2026-04-16T16:00:00Z'),
    });
    expect(again.alreadyDone).toBe(true);
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it('advances past missed cycles so the next fire is in the future', async () => {
    const weekly = makeTask({
      scheduledAt: new Date('2026-04-01T09:00:00Z'),
      recurrence: { type: 'weekly' },
    });
    jest.setSystemTime(new Date('2026-04-22T10:00:00Z'));
    taskRepository.findById.mockResolvedValue(weekly);
    taskRepository.update.mockImplementation(async ({ scheduledAt }) =>
      makeTask({ ...weekly, scheduledAt: scheduledAt ?? weekly.scheduledAt }),
    );

    await usecase.execute({ taskId: 'task-1' });

    const called = taskRepository.update.mock.calls[0]?.[0];
    expect(called?.scheduledAt).toEqual(new Date('2026-04-29T09:00:00Z'));
  });

  it('completes a todo (no time) like a one-shot task', async () => {
    const todo = makeTask({ scheduledAt: null });
    taskRepository.findById.mockResolvedValue(todo);
    taskRepository.update.mockResolvedValue({
      ...todo,
      status: TaskStatus.Completed,
    });

    await usecase.execute({ taskId: 'task-1' });

    expect(taskRepository.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Completed,
      completedAt: now,
    });
  });

  it('throws TaskNotFoundError when the task does not exist', async () => {
    taskRepository.findById.mockResolvedValue(null);
    await expect(usecase.execute({ taskId: 'missing' })).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });

  it('wraps unexpected errors in FailedToUpdateTaskError', async () => {
    taskRepository.findById.mockResolvedValue(makeTask());
    taskRepository.update.mockRejectedValue(new Error('db error'));
    await expect(usecase.execute({ taskId: 'task-1' })).rejects.toBeInstanceOf(
      FailedToUpdateTaskError,
    );
  });
});
