import { Task } from '@domain/task';

export type ListTasksInput = {
  userId: string;
  includeCompleted?: boolean;
};

export type TaskWithOverdueFlag = Task & {
  isOverdue: boolean;
};

export type ListTasksOutput = {
  tasks: TaskWithOverdueFlag[];
};
