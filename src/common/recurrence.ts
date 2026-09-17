import {
  addDays,
  addMonths,
  addWeeks,
  getDate,
  getDay,
  getDaysInMonth,
  setDate,
  startOfMonth,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { Recurrence } from '@domain/task';

/**
 * Recurrence arithmetic happens on the wall clock of the task's timezone,
 * not on absolute instants: "daily at 09:00" must stay at 09:00 across a
 * DST switch, and "monthly on the 31st" must return to the 31st after a
 * short month (which is what `anchorAt` is for).
 */

/**
 * Next occurrence strictly after `now`. If the task fell behind by many
 * cycles we advance until future — otherwise a recurring reminder that fell
 * behind would stay forever overdue and keep firing reminders.
 */
export function computeNextOccurrence(
  current: Date,
  recurrence: Recurrence,
  now: Date = new Date(),
  timezone = 'UTC',
): Date {
  let next = advanceOnce(current, recurrence, timezone);
  // Cap the iteration count so a bad config can't hang the server.
  for (let i = 0; i < 1000 && next.getTime() <= now.getTime(); i++) {
    next = advanceOnce(next, recurrence, timezone);
  }
  return next;
}

/**
 * Latest occurrence at or before `now`, starting from `current`. Returns
 * `current` unchanged while the next occurrence is still in the future. Used
 * to roll an ignored recurring task onto its newest cycle so it gets reminded
 * again instead of staying stuck on a missed one.
 */
export function computeLatestOccurrence(
  current: Date,
  recurrence: Recurrence,
  now: Date = new Date(),
  timezone = 'UTC',
): Date {
  let latest = current;
  for (let i = 0; i < 1000; i++) {
    const next = advanceOnce(latest, recurrence, timezone);
    if (next.getTime() > now.getTime()) break;
    latest = next;
  }
  return latest;
}

/**
 * Human-readable label for a recurrence, e.g. "every weekday". Returns null
 * for one-shot tasks so callers can skip the line entirely.
 */
export function describeRecurrence(
  recurrence: Recurrence | null | undefined,
): string | null {
  if (!recurrence) return null;
  switch (recurrence.type) {
    case 'daily':
      return 'every day';
    case 'weekdays':
      return 'every weekday';
    case 'weekly':
      return 'every week';
    case 'monthly':
      return 'every month';
    case 'every_n_days': {
      const n = Math.max(1, Math.floor(recurrence.intervalDays ?? 1));
      return n === 1 ? 'every day' : `every ${n} days`;
    }
  }
}

function advanceOnce(
  current: Date,
  recurrence: Recurrence,
  timezone: string,
): Date {
  // `zoned` carries the task's wall-clock fields in the process's local
  // time so date-fns' calendar arithmetic (which preserves local h:m:s)
  // operates on the user's calendar day, not the UTC one.
  const zoned = toZonedTime(current, timezone);
  const back = (d: Date): Date => fromZonedTime(d, timezone);

  switch (recurrence.type) {
    case 'daily':
      return back(addDays(zoned, 1));
    case 'weekdays':
      return back(nextWeekday(zoned));
    case 'weekly':
      return back(addWeeks(zoned, 1));
    case 'monthly':
      return back(
        nextMonth(zoned, anchorDayOfMonth(recurrence, zoned, timezone)),
      );
    case 'every_n_days': {
      const interval = Math.max(1, Math.floor(recurrence.intervalDays ?? 1));
      return back(addDays(zoned, interval));
    }
  }
}

/**
 * Adds 1 day, then skips forward past Sat/Sun so we always land on Mon-Fri.
 */
function nextWeekday(current: Date): Date {
  let candidate = addDays(current, 1);
  while (true) {
    const day = getDay(candidate);
    if (day !== 0 && day !== 6) return candidate; // not Sun (0) or Sat (6)
    candidate = addDays(candidate, 1);
  }
}

/**
 * Same wall-clock time on `anchorDay` of the next month, clamped to that
 * month's length (31st → Feb 28th → Mar 31st, not Mar 28th).
 */
function nextMonth(current: Date, anchorDay: number): Date {
  const firstOfNext = addMonths(startOfMonth(current), 1);
  const day = Math.min(anchorDay, getDaysInMonth(firstOfNext));
  const dated = setDate(firstOfNext, day);
  dated.setHours(
    current.getHours(),
    current.getMinutes(),
    current.getSeconds(),
    current.getMilliseconds(),
  );
  return dated;
}

function anchorDayOfMonth(
  recurrence: Recurrence,
  fallback: Date,
  timezone: string,
): number {
  if (recurrence.anchorAt)
    return getDate(toZonedTime(recurrence.anchorAt, timezone));
  return getDate(fallback);
}
