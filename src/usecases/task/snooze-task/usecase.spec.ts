import { SnoozeTaskUsecase } from './usecase';
import { TaskStatus } from '@domain/task';
import { InvalidInputError } from '@common/errors';
import { TaskNotFoundError } from '@domain/task/errors';
import { makeTask, mockTaskRepository } from '@test/factories';

describe('SnoozeTaskUsecase', () => {
  const now = new Date('2026-04-16T12:00:00Z');
  const tonight = new Date('2026-04-16T20:00:00Z');
  let repo: ReturnType<typeof mockTaskRepository>;
  let usecase: SnoozeTaskUsecase;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    repo = mockTaskRepository();
    repo.update.mockImplementation(async () => makeTask());
    usecase = new SnoozeTaskUsecase(repo);
  });
  afterEach(() => jest.useRealTimers());

  it('moves a one-shot task to the given time', async () => {
    repo.findById.mockResolvedValue(makeTask());
    await usecase.execute({ taskId: 'task-1', until: tonight });
    expect(repo.update).toHaveBeenCalledWith({
      id: 'task-1',
      scheduledAt: tonight,
      snoozedUntil: null,
      incrementSnoozeCount: true,
    });
  });

  it('snoozes only this occurrence of a recurring task', async () => {
    repo.findById.mockResolvedValue(
      makeTask({ recurrence: { type: 'daily' } }),
    );
    await usecase.execute({ taskId: 'task-1', until: tonight });
    expect(repo.update).toHaveBeenCalledWith({
      id: 'task-1',
      snoozedUntil: tonight,
      incrementSnoozeCount: true,
    });
  });

  it.each([
    ['a past time', () => makeTask(), new Date('2026-04-16T11:00:00Z')],
    [
      'a completed task',
      () => makeTask({ status: TaskStatus.Completed }),
      tonight,
    ],
    ['a todo', () => makeTask({ scheduledAt: null }), tonight],
  ])('rejects %s', async (_label, task, until) => {
    repo.findById.mockResolvedValue(task());
    await expect(
      usecase.execute({ taskId: 'task-1', until }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('404s on a missing task', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      usecase.execute({ taskId: 'x', until: tonight }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});
