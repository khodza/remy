import { Task } from '@domain/task';

export type MarkCompleteInput = {
  taskId: string;
};

export type MarkCompleteOutput = Task;
