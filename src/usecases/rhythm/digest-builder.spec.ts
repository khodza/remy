import { DigestBuilder } from './digest-builder';
import { TaskStatus } from '@domain/task';
import { makeTask, makeUser, mockTaskRepository } from '@test/factories';

const tz = 'Asia/Tashkent'; // UTC+5
const user = makeUser({
  id: 'user-1',
  telegramUserId: 42,
  firstName: 'Izzat',
  timezone: tz,
});

describe('DigestBuilder', () => {
  it('pinned agenda: today (pending + done today), overdue-before count, inbox count', async () => {
    const tasks = mockTaskRepository();
    const now = new Date('2026-09-17T05:00:00Z'); // Thu 10:00 local
    const doneToday = makeTask({
      id: 'done-today',
      status: TaskStatus.Completed,
      scheduledAt: new Date('2026-09-17T03:00:00Z'),
      completedAt: new Date('2026-09-17T03:05:00Z'),
    });
    const doneOld = makeTask({
      id: 'done-old',
      status: TaskStatus.Completed,
      scheduledAt: new Date('2026-09-10T03:00:00Z'), // due last week
      completedAt: new Date('2026-09-17T03:05:00Z'),
    });
    tasks.find.mockImplementation(async (filter) => {
      if (filter.statuses[0] === TaskStatus.Completed)
        return [doneToday, doneOld];
      if (filter.kind === 'todo') return [makeTask({ scheduledAt: null })];
      if (filter.dueAfter) return [makeTask({ id: 'today' })];
      return [makeTask({ id: 'old-1' }), makeTask({ id: 'old-2' })];
    });

    const agenda = await new DigestBuilder(tasks).buildPinnedAgenda(
      user,
      tz,
      now,
    );

    expect(tasks.find).toHaveBeenCalledWith({
      userId: 'user-1',
      statuses: [TaskStatus.Completed],
      kind: 'reminder',
      completedAtOrAfter: new Date('2026-09-16T19:00:00Z'),
      sort: 'dueAt',
    });
    expect(agenda).toMatchObject({
      chatId: 42,
      timezone: tz,
      now,
      overdueBefore: 2,
      inboxCount: 1,
    });
    expect(agenda.today.map((t) => t.id)).toEqual(['today']);
    expect(agenda.doneToday.map((t) => t.id)).toEqual(['done-today']);
  });

  it('brief: today / overdue / inbox by the user day (due time, not fire time)', async () => {
    const tasks = mockTaskRepository();
    tasks.find.mockResolvedValue([]);
    const now = new Date('2026-09-17T03:00:00Z'); // Thu 08:00 local
    await new DigestBuilder(tasks).buildBrief(user, tz, now, true);

    const pending = { userId: 'user-1', statuses: [TaskStatus.Pending] };
    expect(tasks.find).toHaveBeenNthCalledWith(1, {
      ...pending,
      kind: 'reminder',
      dueAfter: new Date('2026-09-16T18:59:59.999Z'),
      dueAtOrBefore: new Date('2026-09-17T18:59:59.999Z'),
      sort: 'dueAt',
    });
    expect(tasks.find).toHaveBeenNthCalledWith(2, {
      ...pending,
      kind: 'reminder',
      dueAtOrBefore: new Date('2026-09-16T18:59:59.999Z'),
      sort: 'dueAt',
    });
    expect(tasks.find).toHaveBeenNthCalledWith(3, {
      ...pending,
      kind: 'todo',
      sort: 'createdAtDesc',
    });
  });

  it('brief: previews three inbox items but counts all', async () => {
    const tasks = mockTaskRepository();
    const todos = ['a', 'b', 'c', 'd'].map((id) =>
      makeTask({ id, scheduledAt: null }),
    );
    tasks.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(todos);
    const brief = await new DigestBuilder(tasks).buildBrief(
      user,
      tz,
      new Date(),
      false,
    );
    expect(brief.inbox.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(brief.inboxCount).toBe(4);
    expect(brief.scheduled).toBe(false);
  });

  it("review: open items and today's completions, one-offs and repeats alike", async () => {
    const tasks = mockTaskRepository();
    const now = new Date('2026-09-17T16:00:00Z'); // 21:00 local
    tasks.find
      .mockResolvedValueOnce([
        makeTask({
          id: 'late',
          scheduledAt: new Date('2026-09-17T06:00:00Z'),
          recurrence: { type: 'daily' },
        }),
      ])
      .mockResolvedValueOnce([
        makeTask({
          id: 'x',
          status: TaskStatus.Completed,
          completedAt: new Date('2026-09-17T05:00:00Z'),
        }),
        makeTask({
          id: 'y',
          status: TaskStatus.Completed,
          completedAt: new Date('2026-09-16T12:00:00Z'),
        }), // yesterday local
        makeTask({
          id: 'gym',
          recurrence: { type: 'daily' },
          completions: [
            {
              at: new Date('2026-09-17T02:30:00Z'),
              occurrenceAt: new Date('2026-09-17T02:00:00Z'),
            },
            {
              at: new Date('2026-09-16T02:30:00Z'),
              occurrenceAt: new Date('2026-09-16T02:00:00Z'),
            },
          ],
        }),
      ]);
    const review = await new DigestBuilder(tasks).buildReview(user, tz, now);
    expect(review.doneToday).toBe(2);
    expect(review.items).toEqual([
      {
        taskId: 'late',
        title: 'Buy groceries',
        dueAt: new Date('2026-09-17T06:00:00Z'),
        recurring: true,
        outcome: null,
        newDueAt: null,
      },
    ]);
    expect(tasks.find).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ dueAtOrBefore: now, limit: 10 }),
    );
  });

  it('wrap: week total, streak, overdue, most snoozed, busiest day next week', async () => {
    const tasks = mockTaskRepository();
    const now = new Date('2026-09-20T16:00:00Z'); // Sun 21:00 local
    const doneOn = (isoLocalNoon: string) =>
      makeTask({
        status: TaskStatus.Completed,
        completedAt: new Date(`${isoLocalNoon}T07:00:00Z`),
      });
    tasks.find
      .mockResolvedValueOnce([
        doneOn('2026-09-20'),
        doneOn('2026-09-19'),
        doneOn('2026-09-18'),
        doneOn('2026-09-16'), // gap on the 17th breaks the streak
        doneOn('2026-09-10'), // last week: not in the total
      ])
      .mockResolvedValueOnce([
        makeTask({ id: 'late', scheduledAt: new Date('2026-09-19T05:00:00Z') }),
        makeTask({
          id: 'dentist',
          description: 'Call the dentist',
          scheduledAt: new Date('2026-09-22T05:00:00Z'),
          snoozeCount: 5,
        }),
        makeTask({
          id: 'todo',
          scheduledAt: null,
          snoozeCount: 4,
          description: 'Plov',
        }),
      ])
      .mockResolvedValueOnce([
        makeTask({ scheduledAt: new Date('2026-09-22T05:00:00Z') }),
        makeTask({ scheduledAt: new Date('2026-09-22T09:00:00Z') }),
        makeTask({ scheduledAt: new Date('2026-09-24T05:00:00Z') }),
      ]);

    const wrap = await new DigestBuilder(tasks).buildWrap(user, tz, now);

    expect(wrap).toMatchObject({
      kind: 'wrap',
      chatId: 42,
      weekStart: new Date('2026-09-13T19:00:00Z'), // Mon 14 Sep 00:00 local
      weekEnd: new Date('2026-09-20T19:00:00Z'),
      done: 4,
      streakDays: 3,
      overdueNow: 1,
      mostSnoozed: [
        { title: 'Call the dentist', count: 5 },
        { title: 'Plov', count: 4 },
      ],
      nextWeekCount: 3,
      busiestDay: { day: new Date('2026-09-22T05:00:00Z'), count: 2 },
    });
  });
});
