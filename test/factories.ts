import type { Task, TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';

/** A pending one-shot task in UTC; override what the test cares about. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  const scheduledAt = overrides.scheduledAt ?? new Date('2026-04-16T11:00:00Z');
  const createdAt = new Date('2026-04-15T10:00:00Z');
  return {
    id: 'task-1',
    userId: 'user-1',
    telegramChatId: 12345,
    description: 'Buy groceries',
    scheduledAt,
    timezone: 'UTC',
    snoozedUntil: null,
    nextFireAt: overrides.snoozedUntil ?? scheduledAt,
    nextAttemptAt: null,
    status: TaskStatus.Pending,
    recurrence: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export function mockTaskRepository(): jest.Mocked<TaskRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
    claimDueReminder: jest.fn().mockResolvedValue(null),
    releaseReminderClaim: jest.fn().mockResolvedValue(undefined),
    findOverdueRecurring: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    delete: jest.fn(),
  };
}
