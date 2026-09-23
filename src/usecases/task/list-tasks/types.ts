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
  /** Caps 'done' and a search. Default 50. */
  limit?: number;
  /** Only tasks on this named list (normalised here). */
  list?: string;
  /**
   * Search text: every word in title, notes or list; pending and completed,
   * pending first. Overrides `view`.
   */
  search?: string;
};

export type TaskWithOverdueFlag = Task & {
  isOverdue: boolean;
};

export type ListTasksOutput = {
  tasks: TaskWithOverdueFlag[];
};
