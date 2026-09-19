import { ListTasksUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('ListTasksUsecase', () => {
  let usecase: ListTasksUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;

  // 12:00Z = 17:00 in Tashkent (UTC+5). Tashkent's day is 19:00Z → 19:00Z.
  const now = new Date('2026-04-16T12:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers({ now });
    taskRepository = mockTaskRepository();
    usecase = new ListTasksUsecase(taskRepository);
  });

  afterEach(() => jest.useRealTimers());

  it('flags pending tasks whose fire time has passed as overdue', async () => {
    taskRepository.find.mockResolvedValue([
      makeTask({ id: 'past', scheduledAt: new Date('2026-04-16T10:00:00Z') }),
      makeTask({ id: 'future', scheduledAt: new Date('2026-04-16T14:00:00Z') }),
      makeTask({
        id: 'snoozed',
        scheduledAt: new Date('2026-04-16T09:00:00Z'),
        snoozedUntil: new Date('2026-04-16T13:00:00Z'),
        recurrence: { type: 'daily' },
      }),
      makeTask({ id: 'todo', scheduledAt: null }),
      makeTask({
        id: 'done',
        scheduledAt: new Date('2026-04-16T08:00:00Z'),
        status: TaskStatus.Completed,
      }),
    ]);

    const { tasks } = await usecase.execute({ userId: 'user-1' });

    expect(Object.fromEntries(tasks.map((t) => [t.id, t.isOverdue]))).toEqual({
      past: true,
      future: false,
      snoozed: false, // the snooze, not the series time, decides
      todo: false,
      done: false,
    });
  });

  it('view=all excludes completed unless asked, and never deleted', async () => {
    await usecase.execute({ userId: 'user-1' });
    expect(taskRepository.find).toHaveBeenLastCalledWith({
      userId: 'user-1',
      statuses: [TaskStatus.Pending, TaskStatus.Overdue],
      sort: 'dueAt',
    });

    await usecase.execute({
      userId: 'user-1',
      view: 'all',
      includeCompleted: true,
    });
    expect(taskRepository.find).toHaveBeenLastCalledWith({
      userId: 'user-1',
      statuses: [TaskStatus.Pending, TaskStatus.Overdue, TaskStatus.Completed],
      sort: 'dueAt',
    });
  });

  it("view=today uses the user's day: due up to local midnight plus done today", async () => {
    const due = makeTask({ id: 'due' });
    const done = makeTask({ id: 'done', status: TaskStatus.Completed });
    taskRepository.find
      .mockResolvedValueOnce([due])
      .mockResolvedValueOnce([done]);

    const { tasks } = await usecase.execute({
      userId: 'user-1',
      view: 'today',
      timezone: 'Asia/Tashkent',
    });

    expect(taskRepository.find).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      kind: 'reminder',
      dueAtOrBefore: new Date('2026-04-16T18:59:59.999Z'), // 23:59:59.999 Tashkent
      sort: 'dueAt',
    });
    expect(taskRepository.find).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      statuses: [TaskStatus.Completed],
      completedAtOrAfter: new Date('2026-04-15T19:00:00.000Z'), // 00:00 Tashkent
      sort: 'completedAtDesc',
    });
    expect(tasks.map((t) => t.id)).toEqual(['due', 'done']);
  });

  it('view=upcoming starts after the end of the local day', async () => {
    await usecase.execute({
      userId: 'user-1',
      view: 'upcoming',
      timezone: 'Asia/Tashkent',
    });
    expect(taskRepository.find).toHaveBeenCalledWith({
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      kind: 'reminder',
      dueAfter: new Date('2026-04-16T18:59:59.999Z'),
      sort: 'dueAt',
    });
  });

  it('view=inbox lists pending todos, newest first', async () => {
    await usecase.execute({ userId: 'user-1', view: 'inbox' });
    expect(taskRepository.find).toHaveBeenCalledWith({
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      kind: 'todo',
      sort: 'createdAtDesc',
    });
  });

  it('view=done is capped (default 50)', async () => {
    await usecase.execute({ userId: 'user-1', view: 'done' });
    expect(taskRepository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'completedAtDesc', limit: 50 }),
    );
    await usecase.execute({ userId: 'user-1', view: 'done', limit: 5 });
    expect(taskRepository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });
});
