import { SkipOccurrenceUsecase } from './usecase';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('SkipOccurrenceUsecase', () => {
  const now = new Date('2026-09-17T10:00:00Z');
  beforeEach(() => jest.useFakeTimers({ now }));
  afterEach(() => jest.useRealTimers());

  it('moves to the next occurrence without recording a completion, and drops the snooze', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(
      makeTask({
        scheduledAt: new Date('2026-09-17T09:00:00Z'),
        snoozedUntil: new Date('2026-09-17T11:00:00Z'),
        recurrence: { type: 'daily' },
      }),
    );
    tasks.update.mockResolvedValue(makeTask());
    await new SkipOccurrenceUsecase(tasks).execute({ taskId: 'task-1' });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: new Date('2026-09-18T09:00:00Z'),
      snoozedUntil: null,
    });
  });

  it('closes the task when that was the last occurrence', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(
      makeTask({
        scheduledAt: new Date('2026-09-17T09:00:00Z'),
        recurrence: { type: 'daily', until: new Date('2026-09-17T23:00:00Z') },
      }),
    );
    tasks.update.mockResolvedValue(makeTask());
    await new SkipOccurrenceUsecase(tasks).execute({ taskId: 'task-1' });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'task-1',
      status: TaskStatus.Completed,
      completedAt: now,
      snoozedUntil: null,
    });
  });

  it('a "× N times" series closes when the skipped occurrence was the last', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(
      makeTask({
        scheduledAt: new Date('2026-09-17T09:00:00Z'),
        recurrence: {
          type: 'daily',
          count: 2,
          anchorAt: new Date('2026-09-16T09:00:00Z'),
        },
      }),
    );
    tasks.update.mockResolvedValue(makeTask());
    await new SkipOccurrenceUsecase(tasks).execute({ taskId: 'task-1' });
    expect(tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.Completed }),
    );
  });

  it('refuses one-offs and finished tasks', async () => {
    const tasks = mockTaskRepository();
    tasks.findById.mockResolvedValue(makeTask());
    await expect(
      new SkipOccurrenceUsecase(tasks).execute({ taskId: 'task-1' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    tasks.findById.mockResolvedValue(
      makeTask({ recurrence: { type: 'daily' }, status: TaskStatus.Completed }),
    );
    await expect(
      new SkipOccurrenceUsecase(tasks).execute({ taskId: 'task-1' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});
