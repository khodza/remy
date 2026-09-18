import {
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus,
  ClaimedReminder,
  TaskFilter,
} from './types';

export interface TaskRepository {
  create(params: CreateTaskParams): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findByUserId(userId: string, status?: TaskStatus): Promise<Task[]>;
  /** Filtered, sorted, optionally limited query used by the Mini App views. */
  find(filter: TaskFilter): Promise<Task[]>;
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
   * Undo a claim after a transient send failure: restore the previous
   * lastSentAt and hold the task until `nextAttemptAt`.
   */
  releaseReminderClaim(
    id: string,
    previousLastSentAt: Date | undefined,
    nextAttemptAt: Date,
  ): Promise<void>;
  /** Pending recurring tasks whose series time is at or before `beforeDate`. */
  findOverdueRecurring(beforeDate: Date): Promise<Task[]>;
  update(params: UpdateTaskParams): Promise<Task>;
  delete(id: string): Promise<void>;
}
