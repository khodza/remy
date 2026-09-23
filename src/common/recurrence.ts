import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  getDate,
  getDay,
  getDaysInMonth,
  setDate,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { Recurrence } from '@domain/task';

/**
 * Recurrence arithmetic happens on the wall clock of the task's timezone,
 * not on absolute instants: "daily at 09:00" must stay at 09:00 across a
 * DST switch, and "monthly on the 31st" must return to the 31st after a
 * short month (which is what `anchorAt` is for).
 */

/**
 * Next occurrence strictly after `now`, or null when the series has ended
 * (`until`). If the task fell behind by many cycles we advance until future
 * — otherwise a recurring reminder that fell behind would stay forever
 * overdue and keep firing reminders.
 */
export function computeNextOccurrence(
  current: Date,
  recurrence: Recurrence,
  now: Date = new Date(),
  timezone = 'UTC',
): Date | null {
  const end = seriesEnd(recurrence, timezone, current);
  let next = advanceOnce(current, recurrence, timezone);
  // Cap the iteration count so a bad config can't hang the server.
  for (let i = 0; i < 1000 && next.getTime() <= now.getTime(); i++) {
    if (end && next.getTime() > end.getTime()) return null;
    next = advanceOnce(next, recurrence, timezone);
  }
  if (end && next.getTime() > end.getTime()) {
    return null;
  }
  return next;
}

/** Most occurrences a "× N times" series may have. */
export const MAX_RECURRENCE_COUNT = 1000;

/**
 * The last instant the series may occur at: `until`, or the Nth occurrence
 * of a "× N times" series (counted from the anchor, on the task's wall
 * clock), whichever is earlier. Null for an open-ended series. `fallback`
 * stands in for a missing anchor (legacy tasks): the count then starts there.
 */
export function seriesEnd(
  recurrence: Recurrence,
  timezone = 'UTC',
  fallbackAnchor?: Date,
): Date | null {
  let end = recurrence.until ?? null;
  const anchor = recurrence.anchorAt ?? fallbackAnchor;
  if (recurrence.count !== undefined && anchor) {
    const last = nthOccurrence(anchor, recurrence, recurrence.count, timezone);
    if (end === null || last.getTime() < end.getTime()) end = last;
  }
  return end;
}

/** Occurrence number `n` (1 = the anchor itself). */
function nthOccurrence(
  anchor: Date,
  recurrence: Recurrence,
  n: number,
  timezone: string,
): Date {
  const steps = Math.min(
    Math.max(0, Math.floor(n) - 1),
    MAX_RECURRENCE_COUNT - 1,
  );
  let at = anchor;
  for (let i = 0; i < steps; i++) at = advanceOnce(at, recurrence, timezone);
  return at;
}

/**
 * Latest occurrence at or before `now` (and not past `until`), starting from
 * `current`. Returns `current` unchanged while the next occurrence is still
 * in the future. Used to roll an ignored recurring task onto its newest
 * cycle so it gets reminded again instead of staying stuck on a missed one.
 */
export function computeLatestOccurrence(
  current: Date,
  recurrence: Recurrence,
  now: Date = new Date(),
  timezone = 'UTC',
): Date {
  const end = seriesEnd(recurrence, timezone, current);
  let latest = current;
  for (let i = 0; i < 1000; i++) {
    const next = advanceOnce(latest, recurrence, timezone);
    if (next.getTime() > now.getTime()) break;
    if (end && next.getTime() > end.getTime()) break;
    latest = next;
  }
  return latest;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Human-readable label for a recurrence, e.g. "every weekday" or
 * "every Mon and Thu until 31 Dec 2026". Returns null for one-shot tasks so
 * callers can skip the line entirely.
 */
export function describeRecurrence(
  recurrence: Recurrence | null | undefined,
  timezone = 'UTC',
): string | null {
  if (!recurrence) return null;
  const n = Math.max(1, Math.floor(recurrence.interval ?? 1));
  const every = (unit: string): string =>
    n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;

  let label: string;
  switch (recurrence.type) {
    case 'daily':
      label = 'every day';
      break;
    case 'weekdays':
      label = 'every weekday';
      break;
    case 'weekly': {
      const days = normaliseWeekdays(recurrence.byWeekday);
      if (days.length === 0) {
        label = every('week');
      } else {
        const names = days.map((d) => WEEKDAY_NAMES[d] ?? '?');
        const list =
          names.length === 1
            ? names[0]!
            : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
        label = n === 1 ? `every ${list}` : `every ${n} weeks on ${list}`;
      }
      break;
    }
    case 'monthly':
      label = recurrence.lastDayOfMonth
        ? n === 1
          ? 'on the last day of every month'
          : `on the last day of every ${n} months`
        : every('month');
      break;
    case 'yearly':
      label = every('year');
      break;
    case 'every_n_days': {
      const d = Math.max(1, Math.floor(recurrence.intervalDays ?? 1));
      label = d === 1 ? 'every day' : `every ${d} days`;
      break;
    }
  }
  if (recurrence.count !== undefined) {
    label += recurrence.count === 1 ? ', once' : `, ${recurrence.count} times`;
  }
  if (recurrence.until) {
    label += ` until ${formatInTimeZone(recurrence.until, timezone, 'd MMM yyyy')}`;
  }
  return label;
}

function normaliseWeekdays(days: number[] | undefined): number[] {
  if (!days) return [];
  // Monday-first reads naturally ("Mon and Thu", "Sat and Sun").
  const order = (d: number): number => (d === 0 ? 7 : d);
  return [
    ...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => order(a) - order(b));
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
  const n = Math.max(1, Math.floor(recurrence.interval ?? 1));
  const zonedAnchor = recurrence.anchorAt
    ? toZonedTime(recurrence.anchorAt, timezone)
    : zoned;

  switch (recurrence.type) {
    case 'daily':
      return back(addDays(zoned, 1));
    case 'weekdays':
      return back(nextWeekday(zoned));
    case 'weekly': {
      const days = normaliseWeekdays(recurrence.byWeekday);
      return back(
        days.length === 0
          ? addWeeks(zoned, n)
          : nextListedWeekday(zoned, days, n, zonedAnchor),
      );
    }
    case 'monthly':
      return back(
        monthsLater(
          zoned,
          n,
          recurrence.lastDayOfMonth ? 31 : getDate(zonedAnchor),
        ),
      );
    case 'yearly':
      return back(yearsLater(zoned, n, zonedAnchor));
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
 * The next day whose weekday is listed, in a week that is a multiple of
 * `everyNWeeks` away from the anchor's week (weeks start on Monday).
 */
function nextListedWeekday(
  current: Date,
  days: number[],
  everyNWeeks: number,
  anchor: Date,
): Date {
  const anchorWeek = startOfWeek(anchor, { weekStartsOn: 1 });
  for (let i = 1; i <= 7 * everyNWeeks + 7; i++) {
    const candidate = addDays(current, i);
    if (!days.includes(getDay(candidate))) continue;
    const weeksApart = Math.round(
      differenceInCalendarDays(
        startOfWeek(candidate, { weekStartsOn: 1 }),
        anchorWeek,
      ) / 7,
    );
    if (((weeksApart % everyNWeeks) + everyNWeeks) % everyNWeeks === 0) {
      return candidate;
    }
  }
  return addWeeks(current, everyNWeeks); // unreachable with valid input
}

/**
 * Same wall-clock time `months` later on `anchorDay`, clamped to that
 * month's length (31st → Feb 28th → Mar 31st, not Mar 28th).
 */
function monthsLater(current: Date, months: number, anchorDay: number): Date {
  const firstOfTarget = addMonths(startOfMonth(current), months);
  const day = Math.min(anchorDay, getDaysInMonth(firstOfTarget));
  return withTimeOf(setDate(firstOfTarget, day), current);
}

/** Same month/day as the anchor `years` later; 29 Feb falls back to 28 Feb. */
function yearsLater(current: Date, years: number, anchor: Date): Date {
  const target = new Date(current.getFullYear() + years, anchor.getMonth(), 1);
  const day = Math.min(anchor.getDate(), getDaysInMonth(target));
  return withTimeOf(setDate(target, day), current);
}

function withTimeOf(date: Date, time: Date): Date {
  date.setHours(
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
    time.getMilliseconds(),
  );
  return date;
}
