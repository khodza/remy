import type { Recurrence, Task } from '@domain/task';
import { effectiveDueAt } from '@common/fire-time';
import type { RecurrenceInput, TaskWire } from '@contract/remy-contract';

/** Completions the wire carries: the last 30 days, newest first, at most 50. */
export const RECENT_COMPLETIONS_DAYS = 30;
export const RECENT_COMPLETIONS_MAX = 50;

/** Domain task → the wire shape defined by the contract. */
export function toTaskWire(task: Task, now: Date = new Date()): TaskWire {
  const dueAt = effectiveDueAt(task);
  return {
    id: task.id,
    description: task.description,
    notes: task.notes,
    kind: task.kind,
    scheduledAt: task.scheduledAt ? task.scheduledAt.toISOString() : null,
    timezone: task.timezone,
    snoozedUntil: task.snoozedUntil ? task.snoozedUntil.toISOString() : null,
    // For the client this is "when it is due" (snooze included). The
    // scheduler's internal fire time can be earlier (a pending heads-up) and
    // must not leak into what the app shows as the task's time.
    nextFireAt: dueAt ? dueAt.toISOString() : null,
    leadMinutes: task.leadMinutes,
    status: task.status,
    priority: task.priority,
    categoryId: task.categoryId,
    recurrence: task.recurrence ? recurrenceToWire(task.recurrence) : null,
    source: {
      type: task.source.type,
      originalText: task.source.originalText,
      messageId: task.source.messageId,
      forwardedFrom: task.source.forwardedFrom,
    },
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    completionsCount: task.completions.length,
    completions: recentCompletions(task, now),
    snoozeCount: task.snoozeCount,
    isOverdue:
      task.status === 'pending' &&
      dueAt !== null &&
      dueAt.getTime() < now.getTime(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function recentCompletions(task: Task, now: Date): TaskWire['completions'] {
  const since = now.getTime() - RECENT_COMPLETIONS_DAYS * 24 * 60 * 60 * 1000;
  return task.completions
    .filter((c) => c.at.getTime() >= since)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, RECENT_COMPLETIONS_MAX)
    .map((c) => ({
      at: c.at.toISOString(),
      occurrenceAt: c.occurrenceAt.toISOString(),
    }));
}

/** Domain recurrence → wire (the anchor is internal and never leaves the server). */
export function recurrenceToWire(recurrence: Recurrence): RecurrenceInput {
  return {
    type: recurrence.type,
    // Only every_n_days has an interval in days (legacy rows may carry one).
    ...(recurrence.type === 'every_n_days' &&
    recurrence.intervalDays !== undefined
      ? { intervalDays: recurrence.intervalDays }
      : {}),
    ...(recurrence.interval !== undefined
      ? { interval: recurrence.interval }
      : {}),
    ...(recurrence.byWeekday !== undefined
      ? { byWeekday: [...recurrence.byWeekday] }
      : {}),
    ...(recurrence.lastDayOfMonth ? { lastDayOfMonth: true } : {}),
    ...(recurrence.until !== undefined
      ? { until: recurrence.until.toISOString() }
      : {}),
    ...(recurrence.count !== undefined ? { count: recurrence.count } : {}),
  };
}

/** Wire recurrence (request body) → domain, without an anchor; use cases add it. */
export function recurrenceFromWire(
  input: RecurrenceInput,
): Omit<Recurrence, 'anchorAt'> {
  return {
    type: input.type,
    ...(input.intervalDays !== undefined
      ? { intervalDays: input.intervalDays }
      : {}),
    ...(input.interval !== undefined ? { interval: input.interval } : {}),
    ...(input.byWeekday !== undefined
      ? { byWeekday: [...input.byWeekday] }
      : {}),
    ...(input.lastDayOfMonth ? { lastDayOfMonth: true } : {}),
    ...(input.until !== undefined ? { until: new Date(input.until) } : {}),
    ...(input.count !== undefined ? { count: input.count } : {}),
  };
}
