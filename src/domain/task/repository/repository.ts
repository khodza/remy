import {
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus,
  ClaimedReminder,
  TaskFilter,
  ListSummary,
} from './types';

export interface TaskRepository {
  create(params: CreateTaskParams): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findByUserId(userId: string, status?: TaskStatus): Promise<Task[]>;
  /** Filtered, sorted, optionally limited query used by the Mini App views. */
  find(filter: TaskFilter): Promise<Task[]>;
  /** The user's named lists (non-deleted tasks), by name. */
  listSummaries(userId: string): Promise<ListSummary[]>;
  /** Hard-deletes every task of the user ("delete all my data"); returns how many. */
  deleteAllForUser(userId: string): Promise<number>;
  /** Removes a deleted category from every task of the user that carries it. */
  clearCategory(userId: string, categoryId: string): Promise<void>;
  /**
   * Atomically claims one pending task that is due (nextFireAt <= now, not
   * yet reminded for this nextFireAt, no retry hold) by stamping
   * lastSentAt = now, so two runs can never both send it. Null when nothing
   * is due.
   */
  claimDueReminder(now: Date): Promise<ClaimedReminder | null>;
  /**
   * Undo a claim after a transient send failure (or a quiet-hours hold):
   * restore the previous lastSentAt and hold the task until
   * `nextAttemptAt`. With `countAttempt`, the failure is added to
   * reminderAttempts so the next hold can be longer.
   */
  releaseReminderClaim(
    id: string,
    previousLastSentAt: Date | undefined,
    nextAttemptAt: Date,
    options?: { countAttempt?: boolean },
  ): Promise<void>;
  /**
   * Every retry failed: keep the claim (no more attempts for this fire
   * time) and mark the task so the next morning brief can say so.
   */
  markDeliveryFailed(id: string, at: Date): Promise<void>;
  /** Pending recurring tasks whose series time is at or before `beforeDate`. */
  findOverdueRecurring(beforeDate: Date): Promise<Task[]>;
  update(params: UpdateTaskParams): Promise<Task>;
  delete(id: string): Promise<void>;
}
