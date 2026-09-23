import type { Task, TaskRepository } from '@domain/task/repository';
import { TaskStatus } from '@domain/task';
import type { User, UserRepository } from '@domain/user';
import type { DigestKind, ReviewOutcome, ReviewState } from '@domain/rhythm';
import type {
  ConversationRepository,
  ConversationState,
  UndoRecord,
} from '@domain/conversation';
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
    leadSentFor: null,
    nudgeAt: null,
    nudgeCount: 0,
    snoozeCount: 0,
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
    calendarToken: null,
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
  const claimed = new Set<string>();
  return {
    current: () => user,
    listAll: jest.fn(async () => [user]),
    claimDigest: jest.fn(
      async (userId: string, kind: DigestKind, localDate: string) => {
        const key = `${userId}:${kind}:${localDate}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    ),
    releaseDigest: jest.fn(
      async (userId: string, kind: DigestKind, localDate: string) => {
        claimed.delete(`${userId}:${kind}:${localDate}`);
      },
    ),
    save: jest.fn(async (_params) => user),
    findByTelegramUserId: jest.fn(async (_telegramUserId: number) => user),
    findById: jest.fn(async (id: string) => (id === user.id ? user : null)),
    findByCalendarToken: jest.fn(async (token: string) =>
      user.calendarToken !== null && token === user.calendarToken ? user : null,
    ),
    update: jest.fn(async (params) => {
      user = {
        ...user,
        ...(params.timezone !== undefined ? { timezone: params.timezone } : {}),
        ...(params.settings !== undefined ? { settings: params.settings } : {}),
        ...(params.categories !== undefined
          ? { categories: params.categories }
          : {}),
        ...(params.calendarToken !== undefined
          ? { calendarToken: params.calendarToken }
          : {}),
      };
      return user;
    }),
  };
}

/** In-memory conversation store with real behaviour (links, state, one-shot undo). */
export function mockConversationRepository(): jest.Mocked<ConversationRepository> & {
  undos: Map<string, UndoRecord & { used: boolean }>;
} {
  const links = new Map<string, string[]>();
  const state: ConversationState = {
    chatId: 0,
    pendingQuestion: null,
    pendingForward: null,
    lastTaskIds: [],
  };
  const undos = new Map<string, UndoRecord & { used: boolean }>();
  const reviews = new Map<string, ReviewState>();
  let seq = 0;
  return {
    undos,
    saveReview: jest.fn(
      async (chatId: number, messageId: number, review: ReviewState) => {
        reviews.set(`${chatId}:${messageId}`, structuredClone(review));
        links.set(
          `${chatId}:${messageId}`,
          review.items.map((i) => i.taskId),
        );
      },
    ),
    getReview: jest.fn(async (chatId: number, messageId: number) => {
      const r = reviews.get(`${chatId}:${messageId}`);
      return r ? structuredClone(r) : null;
    }),
    resolveReviewItem: jest.fn(
      async (
        chatId: number,
        messageId: number,
        taskId: string,
        outcome: ReviewOutcome,
        newDueAt: Date | null,
      ) => {
        const r = reviews.get(`${chatId}:${messageId}`);
        const item = r?.items.find(
          (i) => i.taskId === taskId && i.outcome === null,
        );
        if (!r || !item) return null;
        item.outcome = outcome;
        item.newDueAt = newDueAt;
        return structuredClone(r);
      },
    ),
    linkMessage: jest.fn(async (link) => {
      links.set(`${link.chatId}:${link.messageId}`, link.taskIds);
    }),
    findLinkedTaskIds: jest.fn(
      async (chatId: number, messageId: number) =>
        links.get(`${chatId}:${messageId}`) ?? [],
    ),
    getState: jest.fn(async (chatId: number) => ({ ...state, chatId })),
    setPendingQuestion: jest.fn(async (_chatId, q) => {
      state.pendingQuestion = q;
    }),
    setPendingForward: jest.fn(async (_chatId, f) => {
      state.pendingForward = f;
    }),
    setLastTaskIds: jest.fn(async (_chatId, ids: string[]) => {
      state.lastTaskIds = ids;
    }),
    saveUndo: jest.fn(async (record) => {
      const id = `undo-${++seq}`;
      undos.set(id, { ...record, id, used: false });
      return id;
    }),
    takeUndo: jest.fn(async (id: string, chatId: number, now: Date) => {
      const record = undos.get(id);
      if (
        !record ||
        record.used ||
        record.chatId !== chatId ||
        record.expiresAt <= now
      )
        return null;
      record.used = true;
      return record;
    }),
  };
}
