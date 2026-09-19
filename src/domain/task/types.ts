export enum TaskStatus {
  Pending = 'pending',
  Completed = 'completed',
  Overdue = 'overdue',
  Deleted = 'deleted',
}

export type RecurrenceType =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'every_n_days'
  | 'yearly';

export type Recurrence = {
  type: RecurrenceType;
  /**
   * Only meaningful when `type === 'every_n_days'`. Integer, >= 1.
   */
  intervalDays?: number;
  /** Every N weeks / months / years. Default 1. */
  interval?: number;
  /** Weekly only: 0 = Sunday … 6 = Saturday ("Mon and Thu" = [1, 4]). */
  byWeekday?: number[];
  /** Monthly only: always the last day of the month. */
  lastDayOfMonth?: boolean;
  /** The series ends after this instant. */
  until?: Date;
  /**
   * The occurrence the series was defined from. Never moved by snoozes or
   * by advancing; used to keep "monthly on the 31st" on the 31st after a
   * short month. Missing on tasks created before this field existed.
   */
  anchorAt?: Date;
};

/** A reminder has a time; a todo has none and lives in the Inbox. */
export type TaskKind = 'reminder' | 'todo';

export type Priority = 'low' | 'normal' | 'high';

export type TaskSourceType = 'text' | 'voice' | 'forward' | 'miniapp';

/** Where a task came from, so a reminder can point back at its origin. */
export type TaskSource = {
  type: TaskSourceType;
  /** The user's own words (chat text or voice transcript). */
  originalText: string | null;
  /** Telegram message id that created the task. */
  messageId: number | null;
  /** Display name a forwarded message came from. */
  forwardedFrom: string | null;
};

/** One "Done" on a recurring task. */
export type Completion = {
  at: Date;
  /** The occurrence that was completed. */
  occurrenceAt: Date;
};

export type Task = {
  id: string;
  userId: string;
  telegramChatId: number;
  /** The title: what to do. */
  description: string;
  notes: string | null;
  /** Derived: 'todo' when scheduledAt is null. */
  kind: TaskKind;
  /**
   * The current occurrence's time (the series time for recurring tasks).
   * Null for todos.
   */
  scheduledAt: Date | null;
  /** IANA zone the task was created in; every display uses it. */
  timezone: string;
  /**
   * Set when a recurring task's current occurrence was delayed: the
   * reminder fires at this time instead of scheduledAt, and the series is
   * untouched. Cleared when the occurrence is completed or rolled over.
   */
  snoozedUntil: Date | null;
  /**
   * When the scheduler next pings: the snooze, else the heads-up
   * (scheduledAt - leadMinutes) until it was sent, else scheduledAt.
   * See common/fire-time.ts.
   */
  nextFireAt: Date | null;
  /** Earliest time the scheduler may retry after a transient send failure. */
  nextAttemptAt: Date | null;
  /** Heads-up this many minutes before scheduledAt. */
  leadMinutes: number | null;
  /** The occurrence (scheduledAt) the heads-up was already sent for. */
  leadSentFor: Date | null;
  status: TaskStatus;
  priority: Priority;
  categoryId: string | null;
  /** Null when the task is one-shot. */
  recurrence: Recurrence | null;
  source: TaskSource;
  /** When a one-shot task was completed. */
  completedAt: Date | null;
  /** History of "Done" taps on a recurring task. */
  completions: Completion[];
  lastSentAt?: Date; // Reminder sent for the current nextFireAt when >= nextFireAt
  createdAt: Date;
  updatedAt: Date;
};

/** A task that is guaranteed to have a time. */
export type ScheduledTask = Task & { scheduledAt: Date; nextFireAt: Date };

export function isScheduled(task: Task): task is ScheduledTask {
  return task.scheduledAt !== null && task.nextFireAt !== null;
}

export type CreateTaskParams = {
  userId: string;
  telegramChatId: number;
  description: string;
  /** Null creates a todo. */
  scheduledAt: Date | null;
  timezone: string;
  source: TaskSource;
  notes?: string | null;
  recurrence?: Recurrence | null;
  priority?: Priority;
  categoryId?: string | null;
  leadMinutes?: number | null;
};

export type UpdateTaskParams = {
  id: string;
  description?: string;
  notes?: string | null;
  /** Null turns the task into a todo. */
  scheduledAt?: Date | null;
  timezone?: string;
  /** Explicitly null clears the snooze; undefined leaves it unchanged. */
  snoozedUntil?: Date | null;
  nextAttemptAt?: Date | null;
  leadMinutes?: number | null;
  leadSentFor?: Date | null;
  status?: TaskStatus;
  priority?: Priority;
  categoryId?: string | null;
  completedAt?: Date | null;
  /** Appended to `completions`. */
  pushCompletion?: Completion;
  /** Keep only the first N completions (undo of a recurring Done). */
  truncateCompletions?: number;
  lastSentAt?: Date;
  /** Explicitly null clears recurrence; undefined leaves it unchanged. */
  recurrence?: Recurrence | null;
};

/** Composable query for the Mini App's views. All conditions are ANDed. */
export type TaskFilter = {
  userId: string;
  statuses: TaskStatus[];
  kind?: TaskKind;
  /** nextFireAt <= value */
  fireAtOrBefore?: Date;
  /** nextFireAt > value */
  fireAfter?: Date;
  /** completedAt >= value */
  completedAtOrAfter?: Date;
  sort: 'fireAt' | 'completedAtDesc' | 'createdAtDesc';
  limit?: number;
};

/** What the scheduler gets back from an atomic claim. */
export type ClaimedReminder = {
  /** The task after the claim (lastSentAt already stamped). */
  task: ScheduledTask;
  /** lastSentAt before the claim, to restore on a transient failure. */
  previousLastSentAt: Date | undefined;
};
