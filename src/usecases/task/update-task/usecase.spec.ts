import { UpdateTaskUsecase } from './usecase';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import {
  makeTask,
  makeUser,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

describe('UpdateTaskUsecase', () => {
  const scheduledAt = new Date('2026-04-16T09:00:00Z');
  const moved = new Date('2026-04-20T18:00:00Z');
  const anchored = {
    type: 'monthly' as const,
    anchorAt: new Date('2026-01-31T09:00:00Z'),
  };
  let tasks: ReturnType<typeof mockTaskRepository>;
  let usecase: UpdateTaskUsecase;

  beforeEach(() => {
    tasks = mockTaskRepository();
    tasks.update.mockImplementation(async () => makeTask());
    const users = mockUserRepository(
      makeUser({
        categories: [
          {
            id: 'a'.repeat(24),
            name: 'Work',
            emoji: '💼',
            color: '#5B5BD6',
            keywords: [],
          },
        ],
      }),
    );
    usecase = new UpdateTaskUsecase(tasks, users);
  });

  it('editing text fields leaves time, snooze and anchor alone', async () => {
    tasks.findById.mockResolvedValue(
      makeTask({ scheduledAt, recurrence: anchored }),
    );
    await usecase.execute({
      taskId: 'task-1',
      description: '  New title ',
      notes: 'n',
      priority: 'high',
    });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'task-1',
      description: 'New title',
      notes: 'n',
      priority: 'high',
    });
  });

  it('a new time clears the snooze and re-anchors an existing recurrence', async () => {
    tasks.findById.mockResolvedValue(
      makeTask({ scheduledAt, recurrence: anchored }),
    );
    await usecase.execute({ taskId: 'task-1', scheduledAt: moved });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: moved,
      snoozedUntil: null,
      recurrence: { type: 'monthly', anchorAt: moved },
    });
  });

  it('a new recurrence is anchored at the (unchanged) time; null clears it', async () => {
    tasks.findById.mockResolvedValue(makeTask({ scheduledAt }));
    await usecase.execute({ taskId: 'task-1', recurrence: { type: 'weekly' } });
    expect(tasks.update).toHaveBeenLastCalledWith({
      id: 'task-1',
      recurrence: { type: 'weekly', anchorAt: scheduledAt },
    });

    await usecase.execute({ taskId: 'task-1', recurrence: null });
    expect(tasks.update).toHaveBeenLastCalledWith({
      id: 'task-1',
      recurrence: null,
    });
  });

  it('scheduledAt: null turns a reminder into a todo and drops everything time-based', async () => {
    tasks.findById.mockResolvedValue(
      makeTask({ scheduledAt, recurrence: anchored, leadMinutes: 30 }),
    );
    await usecase.execute({ taskId: 'task-1', scheduledAt: null });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: null,
      snoozedUntil: null,
      recurrence: null,
      leadMinutes: null,
    });
  });

  it('scheduling a todo works; recurrence or lead time on a todo do not', async () => {
    tasks.findById.mockResolvedValue(makeTask({ scheduledAt: null }));
    await usecase.execute({
      taskId: 'task-1',
      scheduledAt: moved,
      leadMinutes: 15,
    });
    expect(tasks.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: moved,
      snoozedUntil: null,
      leadMinutes: 15,
    });

    await expect(
      usecase.execute({ taskId: 'task-1', recurrence: { type: 'daily' } }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(
      usecase.execute({ taskId: 'task-1', leadMinutes: 15 }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it("accepts only the user's own categories", async () => {
    tasks.findById.mockResolvedValue(makeTask());
    await usecase.execute({ taskId: 'task-1', categoryId: 'a'.repeat(24) });
    expect(tasks.update).toHaveBeenLastCalledWith({
      id: 'task-1',
      categoryId: 'a'.repeat(24),
    });
    await usecase.execute({ taskId: 'task-1', categoryId: null });
    expect(tasks.update).toHaveBeenLastCalledWith({
      id: 'task-1',
      categoryId: null,
    });
    await expect(
      usecase.execute({ taskId: 'task-1', categoryId: 'b'.repeat(24) }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('refuses completed tasks and blank titles', async () => {
    tasks.findById.mockResolvedValue(
      makeTask({ status: TaskStatus.Completed }),
    );
    await expect(
      usecase.execute({ taskId: 'task-1', notes: 'x' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    tasks.findById.mockResolvedValue(makeTask());
    await expect(
      usecase.execute({ taskId: 'task-1', description: '   ' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});
