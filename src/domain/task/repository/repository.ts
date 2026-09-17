import { Task, CreateTaskParams, UpdateTaskParams, TaskStatus } from './types';

export interface TaskRepository {
  create(params: CreateTaskParams): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findByUserId(userId: string, status?: TaskStatus): Promise<Task[]>;
  /** Pending tasks due by `beforeDate` not yet reminded for their current scheduledAt. */
  findPendingReminders(beforeDate: Date): Promise<Task[]>;
  /** Pending recurring tasks scheduled at or before `beforeDate`, reminded or not. */
  findOverdueRecurring(beforeDate: Date): Promise<Task[]>;
  update(params: UpdateTaskParams): Promise<Task>;
  delete(id: string): Promise<void>;
}
