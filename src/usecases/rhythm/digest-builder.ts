import { Inject, Injectable } from '@nestjs/common';
import { addDays, subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import {
  type Task,
  type TaskRepository,
  TaskStatus,
} from '@domain/task/repository';
import type { User } from '@domain/user';
import type {
  EveningReview,
  MorningBrief,
  PinnedAgenda,
  WeeklyWrap,
} from '@domain/rhythm';
import { Domain } from '@common/tokens';
import { dayBoundsInZone } from '@common/day-bounds';
import { effectiveDueAt } from '@common/fire-time';

const INBOX_PREVIEW = 3;
const REVIEW_MAX_ITEMS = 10;
const STREAK_LOOKBACK_DAYS = 60;
const SNOOZE_WARNING = 4;

/** Reads the user's tasks and turns them into brief / review / wrap content. */
@Injectable()
export class DigestBuilder {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
  ) {}

  public async buildBrief(
    user: User,
    timezone: string,
    now: Date,
    scheduled: boolean,
  ): Promise<MorningBrief> {
    const { start, end } = dayBoundsInZone(now, timezone);
    const pending = { userId: user.id, statuses: [TaskStatus.Pending] };
    const [today, overdue, inbox, undelivered] = await Promise.all([
      this.tasks.find({
        ...pending,
        kind: 'reminder',
        dueAfter: new Date(start.getTime() - 1),
        dueAtOrBefore: new Date(end.getTime() - 1),
        sort: 'dueAt',
      }),
      this.tasks.find({
        ...pending,
        kind: 'reminder',
        dueAtOrBefore: new Date(start.getTime() - 1),
        sort: 'dueAt',
      }),
      this.tasks.find({ ...pending, kind: 'todo', sort: 'createdAtDesc' }),
      this.tasks.find({ ...pending, deliveryFailed: true, sort: 'dueAt' }),
    ]);
    return {
      kind: 'brief',
      chatId: user.telegramUserId,
      timezone,
      now,
      firstName: user.firstName,
      today,
      overdue,
      undelivered,
      inbox: inbox.slice(0, INBOX_PREVIEW),
      inboxCount: inbox.length,
      scheduled,
    };
  }

  public async buildPinnedAgenda(
    user: User,
    timezone: string,
    now: Date,
  ): Promise<PinnedAgenda> {
    const { start, end } = dayBoundsInZone(now, timezone);
    const pending = { userId: user.id, statuses: [TaskStatus.Pending] };
    const lastOfYesterday = new Date(start.getTime() - 1);
    const [today, done, overdue, inbox] = await Promise.all([
      this.tasks.find({
        ...pending,
        kind: 'reminder',
        dueAfter: lastOfYesterday,
        dueAtOrBefore: new Date(end.getTime() - 1),
        sort: 'dueAt',
      }),
      this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Completed],
        kind: 'reminder',
        completedAtOrAfter: start,
        sort: 'dueAt',
      }),
      this.tasks.find({
        ...pending,
        kind: 'reminder',
        dueAtOrBefore: lastOfYesterday,
        sort: 'dueAt',
      }),
      this.tasks.find({ ...pending, kind: 'todo', sort: 'createdAtDesc' }),
    ]);
    return {
      chatId: user.telegramUserId,
      timezone,
      now,
      today,
      // Only what was due today: a done task from last week is not today's.
      doneToday: done.filter((task) => {
        const due = effectiveDueAt(task);
        return due !== null && due >= start && due < end;
      }),
      overdueBefore: overdue.length,
      inboxCount: inbox.length,
    };
  }

  public async buildReview(
    user: User,
    timezone: string,
    now: Date,
  ): Promise<EveningReview> {
    const { start } = dayBoundsInZone(now, timezone);
    const [open, touched] = await Promise.all([
      this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Pending],
        kind: 'reminder',
        dueAtOrBefore: now,
        sort: 'dueAt',
        limit: REVIEW_MAX_ITEMS,
      }),
      this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Pending, TaskStatus.Completed],
        updatedAtOrAfter: start,
        sort: 'dueAt',
      }),
    ]);
    return {
      kind: 'review',
      chatId: user.telegramUserId,
      timezone,
      now,
      doneToday: completionTimes(touched).filter((t) => t >= start && t <= now)
        .length,
      items: open.map((task) => ({
        taskId: task.id,
        title: task.description,
        dueAt: effectiveDueAt(task) ?? now,
        recurring: task.recurrence !== null,
        outcome: null,
        newDueAt: null,
      })),
    };
  }

  public async buildWrap(
    user: User,
    timezone: string,
    now: Date,
  ): Promise<WeeklyWrap> {
    const { end: weekEnd } = dayBoundsInZone(now, timezone);
    const { start: weekStart } = dayBoundsInZone(subDays(now, 6), timezone);
    const { start: lookback } = dayBoundsInZone(
      subDays(now, STREAK_LOOKBACK_DAYS),
      timezone,
    );
    const lastOfToday = new Date(weekEnd.getTime() - 1);

    const [touched, pending, nextWeek] = await Promise.all([
      this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Pending, TaskStatus.Completed],
        updatedAtOrAfter: lookback,
        sort: 'dueAt',
      }),
      this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Pending],
        sort: 'dueAt',
      }),
      this.tasks.find({
        userId: user.id,
        statuses: [TaskStatus.Pending],
        kind: 'reminder',
        dueAfter: lastOfToday,
        dueAtOrBefore: addDays(lastOfToday, 7),
        sort: 'dueAt',
      }),
    ]);

    const completions = completionTimes(touched);
    const done = completions.filter(
      (t) => t >= weekStart && t < weekEnd,
    ).length;

    // Streak: consecutive local days with something done, counting back
    // from today (or from yesterday while today is still empty).
    const days = new Set(completions.map((t) => localDay(t, timezone)));
    let streakDays = 0;
    let cursor = days.has(localDay(now, timezone)) ? now : subDays(now, 1);
    while (days.has(localDay(cursor, timezone))) {
      streakDays++;
      cursor = subDays(cursor, 1);
    }

    const overdueNow = pending.filter((t) => {
      const due = effectiveDueAt(t);
      return due !== null && due < now;
    }).length;

    const mostSnoozed = pending
      .filter((t) => t.snoozeCount >= SNOOZE_WARNING)
      .sort((a, b) => b.snoozeCount - a.snoozeCount)
      .slice(0, 3)
      .map((t) => ({ title: t.description, count: t.snoozeCount }));

    const perDay = new Map<string, { day: Date; count: number }>();
    for (const task of nextWeek) {
      const due = effectiveDueAt(task);
      if (!due) continue;
      const key = localDay(due, timezone);
      const entry = perDay.get(key) ?? { day: due, count: 0 };
      entry.count++;
      perDay.set(key, entry);
    }
    const busiestDay =
      [...perDay.values()].sort(
        (a, b) => b.count - a.count || a.day.getTime() - b.day.getTime(),
      )[0] ?? null;

    return {
      kind: 'wrap',
      chatId: user.telegramUserId,
      timezone,
      weekStart,
      weekEnd,
      done,
      streakDays,
      overdueNow,
      mostSnoozed,
      nextWeekCount: nextWeek.length,
      busiestDay,
    };
  }
}

/** Every "done" moment: one-off completions plus Done taps on repeating tasks. */
function completionTimes(tasks: Task[]): Date[] {
  const times: Date[] = [];
  for (const task of tasks) {
    if (task.completedAt) times.push(task.completedAt);
    for (const c of task.completions) times.push(c.at);
  }
  return times;
}

function localDay(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}
