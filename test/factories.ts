import type { Task, TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import type { User, UserRepository } from '@domain/user';
import { DEFAULT_USER_SETTINGS } from '@domain/user';

/**
 * A pending one-shot reminder in UTC; override what the test cares about.
 * `kind` and `nextFireAt` are derived from scheduledAt / snoozedUntil unless
 * given explicitly. Pass `scheduledAt: null` for a todo.
 */
export function makeTask(overrides: Partial<Task> = {}): Task {
  const scheduledAt =
    overrides.scheduledAt !== undefined
      ? overrides.scheduledAt
      : new Date('2026-04-16T11:00:00Z');
  const createdAt = new Date('2026-04-15T10:00:00Z');
  return {
    id: 'task-1',
    userId: 'user-1',
    telegramChatId: 12345,
    description: 'Buy groceries',
    notes: null,
    kind: scheduledAt === null ? 'todo' : 'reminder',
    timezone: 'UTC',
    snoozedUntil: null,
    nextFireAt:
      scheduledAt === null ? null : (overrides.snoozedUntil ?? scheduledAt),
    nextAttemptAt: null,
    leadMinutes: null,
    status: TaskStatus.Pending,
    priority: 'normal',
    categoryId: null,
    recurrence: null,
    source: {
      type: 'text',
      originalText: null,
      messageId: null,
      forwardedFrom: null,
    },
    completedAt: null,
    completions: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
    scheduledAt,
  };
}

export function mockTaskRepository(): jest.Mocked<TaskRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    clearCategory: jest.fn().mockResolvedValue(undefined),
    claimDueReminder: jest.fn().mockResolvedValue(null),
    releaseReminderClaim: jest.fn().mockResolvedValue(undefined),
    findOverdueRecurring: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  const createdAt = new Date('2026-04-01T10:00:00Z');
  return {
    id: 'user-1',
    telegramUserId: 42,
    firstName: 'Owner',
    lastName: null,
    username: null,
    timezone: 'UTC',
    settings: structuredClone(DEFAULT_USER_SETTINGS),
    categories: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/** In-memory user repository: `update` really applies the change. */
export function mockUserRepository(
  initial: User = makeUser(),
): jest.Mocked<UserRepository> & {
  current: () => User;
} {
  let user = initial;
  return {
    current: () => user,
    save: jest.fn(async (_params) => user),
    findByTelegramUserId: jest.fn(async (_telegramUserId: number) => user),
    findById: jest.fn(async (id: string) => (id === user.id ? user : null)),
    update: jest.fn(async (params) => {
      user = {
        ...user,
        ...(params.timezone !== undefined ? { timezone: params.timezone } : {}),
        ...(params.settings !== undefined ? { settings: params.settings } : {}),
        ...(params.categories !== undefined
          ? { categories: params.categories }
          : {}),
      };
      return user;
    }),
  };
}
