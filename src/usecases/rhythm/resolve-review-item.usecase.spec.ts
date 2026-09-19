import { ResolveReviewItemUsecase } from './resolve-review-item.usecase';
import { TaskStatus } from '@domain/task';
import type { ReviewState } from '@domain/rhythm';
import {
  makeTask,
  mockConversationRepository,
  mockTaskRepository,
} from '@test/factories';
import type { MarkCompleteUsecase } from '../task/mark-complete';
import type { SnoozeTaskUsecase } from '../task/snooze-task';
import type { UpdateTaskUsecase } from '../task/update-task';
import type { SkipOccurrenceUsecase } from '../task/skip-occurrence';

describe('ResolveReviewItemUsecase', () => {
  const now = new Date('2026-09-17T16:00:00Z'); // 21:00 Tashkent
  const tomorrow0900 = new Date('2026-09-18T04:00:00Z');
  const review: ReviewState = {
    timezone: 'Asia/Tashkent',
    doneToday: 1,
    items: [
      {
        taskId: 'bill',
        title: 'Pay bill',
        dueAt: new Date('2026-09-17T06:00:00Z'),
        recurring: false,
        outcome: null,
        newDueAt: null,
      },
      {
        taskId: 'gym',
        title: 'Gym',
        dueAt: new Date('2026-09-17T02:00:00Z'),
        recurring: true,
        outcome: null,
        newDueAt: null,
      },
    ],
  };
  let conversations: ReturnType<typeof mockConversationRepository>;
  let tasks: ReturnType<typeof mockTaskRepository>;
  let mark: { execute: jest.Mock };
  let snooze: { execute: jest.Mock };
  let update: { execute: jest.Mock };
  let skip: { execute: jest.Mock };
  let usecase: ResolveReviewItemUsecase;
  const input = { chatId: 42, messageId: 700, userId: 'user-1' };

  beforeEach(async () => {
    jest.useFakeTimers({ now });
    conversations = mockConversationRepository();
    await conversations.saveReview(42, 700, review);
    tasks = mockTaskRepository();
    tasks.findById.mockImplementation(async (id: string) =>
      id === 'gym'
        ? makeTask({ id, recurrence: { type: 'daily' } })
        : makeTask({ id }),
    );
    mark = { execute: jest.fn(async () => makeTask()) };
    snooze = { execute: jest.fn(async () => makeTask()) };
    update = { execute: jest.fn(async () => makeTask()) };
    skip = {
      execute: jest.fn(async () =>
        makeTask({ scheduledAt: new Date('2026-09-18T02:00:00Z') }),
      ),
    };
    usecase = new ResolveReviewItemUsecase(
      conversations,
      tasks,
      mark as unknown as MarkCompleteUsecase,
      snooze as unknown as SnoozeTaskUsecase,
      update as unknown as UpdateTaskUsecase,
      skip as unknown as SkipOccurrenceUsecase,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('done → completes and marks the row', async () => {
    const result = await usecase.execute({
      ...input,
      taskId: 'bill',
      action: 'done',
    });
    expect(mark.execute).toHaveBeenCalledWith({ taskId: 'bill' });
    expect(result?.changed).toBe(true);
    expect(result?.review.items[0]).toMatchObject({ outcome: 'done' });
  });

  it('tomorrow → snoozes to 09:00 in the review zone and records the time', async () => {
    const result = await usecase.execute({
      ...input,
      taskId: 'bill',
      action: 'tomorrow',
    });
    expect(snooze.execute).toHaveBeenCalledWith({
      taskId: 'bill',
      until: tomorrow0900,
    });
    expect(result?.review.items[0]).toMatchObject({
      outcome: 'tomorrow',
      newDueAt: tomorrow0900,
    });
  });

  it('"not now" is Inbox for a one-off and Skip for a repeating task', async () => {
    await usecase.execute({ ...input, taskId: 'bill', action: 'inbox' });
    expect(update.execute).toHaveBeenCalledWith({
      taskId: 'bill',
      scheduledAt: null,
    });

    const result = await usecase.execute({
      ...input,
      taskId: 'gym',
      action: 'inbox',
    });
    expect(skip.execute).toHaveBeenCalledWith({ taskId: 'gym' });
    expect(result?.review.items[1]).toMatchObject({
      outcome: 'skipped',
      newDueAt: new Date('2026-09-18T02:00:00Z'),
    });
  });

  it('a second tap on the same row does nothing', async () => {
    await usecase.execute({ ...input, taskId: 'bill', action: 'done' });
    const again = await usecase.execute({
      ...input,
      taskId: 'bill',
      action: 'tomorrow',
    });
    expect(again?.changed).toBe(false);
    expect(snooze.execute).not.toHaveBeenCalled();
  });

  it('a task finished elsewhere since the review was sent is shown, not acted on', async () => {
    tasks.findById.mockResolvedValue(
      makeTask({ id: 'bill', status: TaskStatus.Completed }),
    );
    const result = await usecase.execute({
      ...input,
      taskId: 'bill',
      action: 'tomorrow',
    });
    expect(snooze.execute).not.toHaveBeenCalled();
    expect(result?.review.items[0]).toMatchObject({ outcome: 'done' });
  });

  it('refuses another user and unknown reviews', async () => {
    expect(
      await usecase.execute({
        ...input,
        userId: 'intruder',
        taskId: 'bill',
        action: 'done',
      }),
    ).toBeNull();
    expect(
      await usecase.execute({
        ...input,
        messageId: 1,
        taskId: 'bill',
        action: 'done',
      }),
    ).toBeNull();
    expect(mark.execute).not.toHaveBeenCalled();
  });

  it('"all to tomorrow" resolves every open row', async () => {
    await usecase.execute({ ...input, taskId: 'bill', action: 'done' });
    const result = await usecase.executeAll(input);
    expect(snooze.execute).toHaveBeenCalledTimes(1);
    expect(snooze.execute).toHaveBeenCalledWith({
      taskId: 'gym',
      until: tomorrow0900,
    });
    expect(result?.review.items.map((i) => i.outcome)).toEqual([
      'done',
      'tomorrow',
    ]);
  });
});
