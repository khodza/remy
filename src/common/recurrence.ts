import { addDays, addMonths, addWeeks, getDay } from 'date-fns';
import { Recurrence } from '@domain/task';

/**
 * Given a task's current scheduledAt + recurrence, return the next occurrence
 * strictly after `now`. If the task has been missed for many cycles we advance
 * until future — otherwise a recurring reminder that fell behind would stay
 * forever overdue and keep firing reminders.
 */
export function computeNextOccurrence(
  current: Date,
  recurrence: Recurrence,
  now: Date = new Date(),
): Date {
  let next = advanceOnce(current, recurrence);
  // Guard: advance until strictly after `now`.
  // Cap the iteration count so a bad config can't hang the server.
  for (let i = 0; i < 1000 && next.getTime() <= now.getTime(); i++) {
    next = advanceOnce(next, recurrence);
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
): Date {
  let latest = current;
  // Same iteration cap as computeNextOccurrence; a task further behind
  // simply catches up over the following calls.
  for (let i = 0; i < 1000; i++) {
    const next = advanceOnce(latest, recurrence);
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

function advanceOnce(current: Date, recurrence: Recurrence): Date {
  switch (recurrence.type) {
    case 'daily':
      return addDays(current, 1);
    case 'weekdays':
      return nextWeekday(current);
    case 'weekly':
      return addWeeks(current, 1);
    case 'monthly':
      return addMonths(current, 1);
    case 'every_n_days': {
      const interval = Math.max(1, Math.floor(recurrence.intervalDays ?? 1));
      return addDays(current, interval);
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
