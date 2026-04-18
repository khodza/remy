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
