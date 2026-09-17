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
  | 'every_n_days';

export type Recurrence = {
  type: RecurrenceType;
  /**
   * Only meaningful when `type === 'every_n_days'`. Integer, >= 1.
   */
  intervalDays?: number;
  /**
   * The occurrence the series was defined from. Never moved by snoozes or
   * by advancing; used to keep "monthly on the 31st" on the 31st after a
   * short month. Missing on tasks created before this field existed.
   */
  anchorAt?: Date;
};

export type Task = {
  id: string;
  userId: string;
  telegramChatId: number;
  description: string;
  /** The current occurrence's time (the series time for recurring tasks). */
  scheduledAt: Date;
  /** IANA zone the task was created in; every display uses it. */
  timezone: string;
  /**
   * Set when a recurring task's current occurrence was delayed: the
   * reminder fires at this time instead of scheduledAt, and the series is
   * untouched. Cleared when the occurrence is completed or rolled over.
   */
  snoozedUntil?: Date | null;
  /** When the reminder actually fires: snoozedUntil ?? scheduledAt. */
  nextFireAt: Date;
  /** Earliest time the scheduler may retry after a transient send failure. */
  nextAttemptAt?: Date | null;
  status: TaskStatus;
  /** Null (or undefined) when the task is one-shot. */
  recurrence?: Recurrence | null;
  lastSentAt?: Date; // Reminder sent for the current nextFireAt when >= nextFireAt
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTaskParams = {
  userId: string;
  telegramChatId: number;
  description: string;
  scheduledAt: Date;
  timezone: string;
  recurrence?: Recurrence | null;
};

export type UpdateTaskParams = {
  id: string;
  description?: string;
  scheduledAt?: Date;
  timezone?: string;
  /** Explicitly null clears the snooze; undefined leaves it unchanged. */
  snoozedUntil?: Date | null;
  nextAttemptAt?: Date | null;
  status?: TaskStatus;
  lastSentAt?: Date;
  /** Explicitly null clears recurrence; undefined leaves it unchanged. */
  recurrence?: Recurrence | null;
};

/** What the scheduler gets back from an atomic claim. */
export type ClaimedReminder = {
  /** The task after the claim (lastSentAt already stamped). */
  task: Task;
  /** lastSentAt before the claim, to restore on a transient failure. */
  previousLastSentAt: Date | undefined;
};
