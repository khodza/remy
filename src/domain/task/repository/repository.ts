import { Task, CreateTaskParams, UpdateTaskParams, TaskStatus } from './types';

export interface TaskRepository {
  create(params: CreateTaskParams): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findByUserId(userId: string, status?: TaskStatus): Promise<Task[]>;
  findPendingReminders(beforeDate: Date): Promise<Task[]>;
  update(params: UpdateTaskParams): Promise<Task>;
  delete(id: string): Promise<void>;
}
