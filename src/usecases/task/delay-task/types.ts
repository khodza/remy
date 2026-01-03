import { Task } from '@domain/task';

export type DelayTaskInput = {
  taskId: string;
  delayMinutes: number;
};

export type DelayTaskOutput = Task;
