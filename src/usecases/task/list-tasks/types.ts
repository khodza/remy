import { Task } from '@domain/task';

export type TaskView = 'all' | 'today' | 'upcoming' | 'inbox' | 'done';

export type ListTasksInput = {
  userId: string;
  /** Defaults to 'all'. */
  view?: TaskView;
  /** Only for view 'all'. */
  includeCompleted?: boolean;
  /** Needed for 'today' / 'upcoming' day bounds. Defaults to UTC. */
  timezone?: string;
  /** Caps 'done'. Default 50. */
  limit?: number;
};

export type TaskWithOverdueFlag = Task & {
  isOverdue: boolean;
};

export type ListTasksOutput = {
  tasks: TaskWithOverdueFlag[];
};
