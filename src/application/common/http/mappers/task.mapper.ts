import type { Task } from '@domain/task';
import type { TaskWire } from '@contract/remy-contract';

/** Domain task → the wire shape defined by the contract. */
export function toTaskWire(task: Task, now: Date = new Date()): TaskWire {
  return {
    id: task.id,
    description: task.description,
    notes: task.notes,
    kind: task.kind,
    scheduledAt: task.scheduledAt ? task.scheduledAt.toISOString() : null,
    timezone: task.timezone,
    snoozedUntil: task.snoozedUntil ? task.snoozedUntil.toISOString() : null,
    nextFireAt: task.nextFireAt ? task.nextFireAt.toISOString() : null,
    leadMinutes: task.leadMinutes,
    status: task.status,
    priority: task.priority,
    categoryId: task.categoryId,
    recurrence: task.recurrence
      ? {
          type: task.recurrence.type,
          ...(task.recurrence.intervalDays !== undefined
            ? { intervalDays: task.recurrence.intervalDays }
            : {}),
        }
      : null,
    source: {
      type: task.source.type,
      originalText: task.source.originalText,
      messageId: task.source.messageId,
      forwardedFrom: task.source.forwardedFrom,
    },
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    completionsCount: task.completions.length,
    isOverdue:
      task.status === 'pending' &&
      task.nextFireAt !== null &&
      task.nextFireAt.getTime() < now.getTime(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
