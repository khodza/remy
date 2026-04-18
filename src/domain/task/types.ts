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
};

export type Task = {
  id: string;
  userId: string;
  telegramChatId: number;
  description: string;
  scheduledAt: Date;
  status: TaskStatus;
  /** Null (or undefined) when the task is one-shot. */
  recurrence?: Recurrence | null;
  lastSentAt?: Date; // Track when reminder was last sent to prevent duplicates
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTaskParams = {
  userId: string;
  telegramChatId: number;
  description: string;
  scheduledAt: Date;
  recurrence?: Recurrence | null;
};

export type UpdateTaskParams = {
  id: string;
  description?: string;
  scheduledAt?: Date;
  status?: TaskStatus;
  lastSentAt?: Date;
  /** Explicitly null clears recurrence; undefined leaves it unchanged. */
  recurrence?: Recurrence | null;
};
