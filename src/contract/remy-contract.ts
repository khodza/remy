/**
 * Remy HTTP contract — the single source of truth for every request and
 * response shape of the Mini App API (`/api/v1`).
 *
 * - The backend validates request bodies with these schemas and asserts its
 *   responses against `wire.*` in tests.
 * - The frontend gets a verbatim copy (`npm run contract:sync` writes
 *   `remy-webapp/src/shared/api/contract.gen.ts`) and parses responses with
 *   `client.*`, which is the same shape with ISO strings coerced to `Date`.
 *
 * Rules: this file imports nothing but zod and must stay free of Node or
 * browser APIs. Change it here, never in the generated copy.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '2.2.0';

// ---------------------------------------------------------------- enums ---

export const TaskStatus = z.enum([
  'pending',
  'completed',
  'overdue',
  'deleted',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A reminder has a time; a todo does not and lives in the Inbox. */
export const TaskKind = z.enum(['reminder', 'todo']);
export type TaskKind = z.infer<typeof TaskKind>;

export const Priority = z.enum(['low', 'normal', 'high']);
export type Priority = z.infer<typeof Priority>;

export const RecurrenceType = z.enum([
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'every_n_days',
  'yearly',
]);
export type RecurrenceType = z.infer<typeof RecurrenceType>;

export const SourceType = z.enum(['text', 'voice', 'forward', 'miniapp']);
export type SourceType = z.infer<typeof SourceType>;

/**
 * - all: every non-deleted task (completed ones only with includeCompleted)
 * - today: pending reminders firing up to the end of today in the user's
 *   zone (overdue included) plus tasks completed today
 * - upcoming: pending reminders firing after today
 * - inbox: pending todos (no time)
 * - done: completed tasks, newest first
 */
export const TaskView = z.enum(['all', 'today', 'upcoming', 'inbox', 'done']);
export type TaskView = z.infer<typeof TaskView>;

export const DefaultView = z.enum(['timeline', 'list']);
export type DefaultView = z.infer<typeof DefaultView>;

// ------------------------------------------------------------ primitives ---

/** ISO 8601 instant as sent on the wire, e.g. 2026-09-18T12:00:00.000Z */
const IsoInstant = z.iso.datetime({ offset: true });
/** Wall-clock "HH:mm", 24-hour. */
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const ObjectIdString = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Expected a 24-char hex id');
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB');

function buildRecurrence<D extends z.ZodType>(date: D) {
  return z.object({
    type: RecurrenceType,
    /** Only meaningful for every_n_days. */
    intervalDays: z.number().int().positive().optional(),
    /** Every N weeks / months / years (weekly, monthly, yearly). Default 1. */
    interval: z.number().int().min(1).max(52).optional(),
    /** Weekly only: days of the week, 0 = Sunday … 6 = Saturday ("Mon and Thu" = [1, 4]). */
    byWeekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    /** Monthly only: always the last day of the month. */
    lastDayOfMonth: z.boolean().optional(),
    /** The series ends after this instant; the last Done completes the task. */
    until: date.optional(),
  });
}

/** Recurrence as sent in requests and on the wire (until is an ISO string). */
export const Recurrence = buildRecurrence(IsoInstant);
export type RecurrenceInput = z.infer<typeof Recurrence>;

export const TaskSource = z.object({
  type: SourceType,
  /** The user's own words (chat text or voice transcript). */
  originalText: z.string().nullable(),
  /** Telegram message id that created the task, to link back into the chat. */
  messageId: z.number().int().nullable(),
  /** Display name of the chat/user a forwarded message came from. */
  forwardedFrom: z.string().nullable(),
});
export type TaskSource = z.infer<typeof TaskSource>;

// ------------------------------------------------- responses (date-generic) ---

function buildResponses<D extends z.ZodType>(date: D) {
  const RecurrenceOut = buildRecurrence(date);
  const Task = z.object({
    id: z.string(),
    /** The title: what to do. */
    description: z.string(),
    notes: z.string().nullable(),
    kind: TaskKind,
    /** Current occurrence (series time when recurring). Null for todos. */
    scheduledAt: date.nullable(),
    /** IANA zone the task was created in. */
    timezone: z.string(),
    /** Set when only the current occurrence of a recurring task was delayed. */
    snoozedUntil: date.nullable(),
    /** When the task is due for the user: snoozedUntil ?? scheduledAt. Null for todos. (A "remind me before" heads-up fires earlier; that time is internal.) */
    nextFireAt: date.nullable(),
    /** Heads-up ping this many minutes before scheduledAt, then the reminder itself. */
    leadMinutes: z.number().int().positive().nullable(),
    status: TaskStatus,
    priority: Priority,
    categoryId: z.string().nullable(),
    recurrence: RecurrenceOut.nullable(),
    source: TaskSource,
    completedAt: date.nullable(),
    /** How many occurrences of a recurring task were marked done. */
    completionsCount: z.number().int().nonnegative(),
    /** How many times it was snoozed or delayed, ever. */
    snoozeCount: z.number().int().nonnegative(),
    /** pending && nextFireAt < now. Always false for todos. */
    isOverdue: z.boolean(),
    createdAt: date,
    updatedAt: date,
  });

  const User = z.object({
    id: z.string(),
    telegramUserId: z.number(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    username: z.string().nullable(),
    timezone: z.string().nullable(),
  });

  return {
    Task,
    TaskList: z.object({ tasks: z.array(Task) }),
    User,
    AuthResult: z.object({ token: z.string(), expiresAt: date, user: User }),
    ParsedTask: z.object({
      description: z.string(),
      scheduledAt: date,
      recurrence: RecurrenceOut.nullable(),
    }),
  };
}

/** Exactly what travels over HTTP (dates are ISO strings). Backend side. */
export const wire = buildResponses(IsoInstant);
/** Same shapes with dates coerced to `Date`. Frontend side. */
export const client = buildResponses(z.coerce.date());

export type Task = z.infer<typeof client.Task>;
export type TaskWire = z.infer<typeof wire.Task>;
export type User = z.infer<typeof client.User>;
export type AuthResult = z.infer<typeof client.AuthResult>;
export type ParsedTask = z.infer<typeof client.ParsedTask>;
/** Recurrence as the frontend sees it in responses (until is a Date). */
export type Recurrence = NonNullable<Task['recurrence']>;

export const DeleteResult = z.object({ success: z.boolean() });
export type DeleteResult = z.infer<typeof DeleteResult>;

export const ErrorBody = z.object({
  statusCode: z.number().int(),
  /** Nest HttpStatus key, e.g. "NOT_FOUND". */
  error: z.string(),
  message: z.string(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

// ------------------------------------------------------------- categories ---

export const Category = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  color: HexColor,
  /** Words that make Remy suggest this category ("dentist" → Health). */
  keywords: z.array(z.string()),
});
export type Category = z.infer<typeof Category>;

export const CategoryList = z.object({ categories: z.array(Category) });

export const CreateCategoryRequest = z
  .object({
    name: z.string().trim().min(1).max(24),
    emoji: z.string().trim().min(1).max(8),
    color: HexColor,
    keywords: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
  })
  .strict();
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequest>;

export const UpdateCategoryRequest = CreateCategoryRequest.partial().strict();
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequest>;

// --------------------------------------------------------------- settings ---

export const Settings = z.object({
  hour12: z.boolean(),
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  defaultView: DefaultView,
  morningBrief: z.object({ enabled: z.boolean(), time: TimeOfDay }),
  eveningReview: z.object({ enabled: z.boolean(), time: TimeOfDay }),
  quietHours: z.object({
    enabled: z.boolean(),
    from: TimeOfDay,
    to: TimeOfDay,
    allowHighPriority: z.boolean(),
  }),
  /**
   * "Still open" nudges for an ignored reminder, this many minutes after it
   * was sent (increasing). Low-priority tasks are never nudged.
   */
  escalation: z.object({
    enabled: z.boolean(),
    stepsMinutes: z.array(z.number().int().positive()).max(5),
  }),
  /** A summary of the week, sent at the evening-review time on the last day of the week. */
  weeklyWrap: z.object({ enabled: z.boolean() }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  hour12: false,
  weekStartsOn: 1,
  defaultView: 'timeline',
  morningBrief: { enabled: true, time: '08:00' },
  eveningReview: { enabled: true, time: '21:00' },
  quietHours: {
    enabled: true,
    from: '23:00',
    to: '07:00',
    allowHighPriority: true,
  },
  escalation: { enabled: true, stepsMinutes: [30, 120] },
  weeklyWrap: { enabled: true },
};

/** Any subset; nested objects may be partial too. */
export const UpdateSettingsRequest = z
  .object({
    hour12: z.boolean(),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    defaultView: DefaultView,
    morningBrief: Settings.shape.morningBrief.partial().strict(),
    eveningReview: Settings.shape.eveningReview.partial().strict(),
    quietHours: Settings.shape.quietHours.partial().strict(),
    escalation: Settings.shape.escalation.partial().strict(),
    weeklyWrap: Settings.shape.weeklyWrap.partial().strict(),
  })
  .partial()
  .strict();
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

// --------------------------------------------------------------- requests ---

const Description = z.string().trim().min(1).max(4000);
const Notes = z.string().max(4000);
const LeadMinutes = z.number().int().min(1).max(10080);

/** POST /tasks — natural language; the server parses it. */
export const CreateTaskFromTextRequest = z
  .object({ text: Description })
  .strict();
export type CreateTaskFromTextRequest = z.infer<
  typeof CreateTaskFromTextRequest
>;

/** POST /tasks/structured — already-reviewed fields; nothing is parsed. */
export const CreateTaskStructuredRequest = z
  .object({
    description: Description,
    notes: Notes.nullable().optional(),
    /** Omit or null for a todo (Inbox). */
    scheduledAt: IsoInstant.nullable().optional(),
    recurrence: Recurrence.nullable().optional(),
    priority: Priority.optional(),
    categoryId: ObjectIdString.nullable().optional(),
    leadMinutes: LeadMinutes.nullable().optional(),
    /** What the user typed, kept as the task's source text. */
    originalText: z.string().max(4000).optional(),
  })
  .strict()
  .refine((v) => !(v.recurrence && !v.scheduledAt), {
    message: 'A recurring task needs a scheduledAt',
    path: ['recurrence'],
  });
export type CreateTaskStructuredRequest = z.infer<
  typeof CreateTaskStructuredRequest
>;

/** PATCH /tasks/:id — undefined leaves a field alone, null clears it. */
export const UpdateTaskRequest = z
  .object({
    description: Description,
    notes: Notes.nullable(),
    /** null turns a reminder into a todo (and clears recurrence + snooze). */
    scheduledAt: IsoInstant.nullable(),
    recurrence: Recurrence.nullable(),
    priority: Priority,
    categoryId: ObjectIdString.nullable(),
    leadMinutes: LeadMinutes.nullable(),
  })
  .partial()
  .strict();
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

export const DelayTaskRequest = z
  .object({ minutes: z.number().int().min(1).max(10080) })
  .strict();
export type DelayTaskRequest = z.infer<typeof DelayTaskRequest>;

/** POST /tasks/:id/snooze — absolute time ("Tonight 20:00"), must be in the future. */
export const SnoozeTaskRequest = z.object({ until: IsoInstant }).strict();
export type SnoozeTaskRequest = z.infer<typeof SnoozeTaskRequest>;

/** GET /tasks query string (all values arrive as strings). */
export const ListTasksQuery = z
  .object({
    view: TaskView.optional(),
    /** Only used by view=all (or no view). */
    includeCompleted: z.enum(['true', 'false']).optional(),
    /** Caps view=done; default 50, max 200. */
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

export const ParseTextRequest = z.object({ text: Description }).strict();
export type ParseTextRequest = z.infer<typeof ParseTextRequest>;

export const UpdateTimezoneRequest = z
  .object({ timezone: z.string().trim().min(1).max(100) })
  .strict();
export type UpdateTimezoneRequest = z.infer<typeof UpdateTimezoneRequest>;

// -------------------------------------------------------------- endpoints ---

/**
 * Every route, relative to the `/api/v1` prefix. `auth: 'tma'` means
 * `Authorization: tma <initDataRaw>`; everything else is `Bearer <jwt>`.
 */
export const endpoints = {
  health: { method: 'GET', path: '/health', auth: 'none' },
  authTelegram: { method: 'POST', path: '/auth/telegram', auth: 'tma' },
  me: { method: 'GET', path: '/user/me', auth: 'jwt' },
  updateTimezone: { method: 'PATCH', path: '/user/timezone', auth: 'jwt' },
  getSettings: { method: 'GET', path: '/settings', auth: 'jwt' },
  updateSettings: { method: 'PATCH', path: '/settings', auth: 'jwt' },
  listCategories: { method: 'GET', path: '/categories', auth: 'jwt' },
  createCategory: { method: 'POST', path: '/categories', auth: 'jwt' },
  updateCategory: { method: 'PATCH', path: '/categories/:id', auth: 'jwt' },
  deleteCategory: { method: 'DELETE', path: '/categories/:id', auth: 'jwt' },
  listTasks: { method: 'GET', path: '/tasks', auth: 'jwt' },
  getTask: { method: 'GET', path: '/tasks/:id', auth: 'jwt' },
  createTaskFromText: { method: 'POST', path: '/tasks', auth: 'jwt' },
  createTaskStructured: {
    method: 'POST',
    path: '/tasks/structured',
    auth: 'jwt',
  },
  createTaskFromVoice: { method: 'POST', path: '/tasks/voice', auth: 'jwt' },
  updateTask: { method: 'PATCH', path: '/tasks/:id', auth: 'jwt' },
  completeTask: { method: 'POST', path: '/tasks/:id/complete', auth: 'jwt' },
  reopenTask: { method: 'POST', path: '/tasks/:id/reopen', auth: 'jwt' },
  delayTask: { method: 'POST', path: '/tasks/:id/delay', auth: 'jwt' },
  snoozeTask: { method: 'POST', path: '/tasks/:id/snooze', auth: 'jwt' },
  deleteTask: { method: 'DELETE', path: '/tasks/:id', auth: 'jwt' },
  parseText: { method: 'POST', path: '/ai/parse', auth: 'jwt' },
} as const;
export type EndpointName = keyof typeof endpoints;
