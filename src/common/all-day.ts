import { set } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { dayBoundsInZone } from './day-bounds';

/**
 * An all-day task is a date with no time. It is stored like any reminder
 * (so views, the scheduler and recurrence need no special case) at a fixed
 * wall-clock time on that date: 09:00 in the task's zone. That is when the
 * scheduler pings it, after the default morning brief (08:00) has already
 * listed it. It is only overdue once its whole day is over.
 */
export const ALL_DAY_HOUR = 9;

/** 09:00 on the local calendar date that `date` falls on in `timezone`. */
export function allDayFireTime(date: Date, timezone: string): Date {
  const zoned = toZonedTime(date, timezone);
  return fromZonedTime(
    set(zoned, {
      hours: ALL_DAY_HOUR,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    }),
    timezone,
  );
}

/**
 * pending && past due. A timed task is overdue from its due time on; an
 * all-day one only after its local day ends. Todos never are.
 */
export function isTaskOverdue(
  task: {
    status: string;
    scheduledAt: Date | null;
    snoozedUntil: Date | null;
    allDay: boolean;
    timezone: string;
  },
  now: Date,
): boolean {
  if (task.status !== 'pending' || task.scheduledAt === null) return false;
  const dueAt = task.snoozedUntil ?? task.scheduledAt;
  if (task.allDay && task.snoozedUntil === null) {
    return now.getTime() >= dayBoundsInZone(dueAt, task.timezone).end.getTime();
  }
  return dueAt.getTime() < now.getTime();
}
