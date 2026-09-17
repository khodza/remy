import { Task } from '@domain/task';

export type MarkCompleteInput = {
  taskId: string;
};

export type MarkCompleteOutput = Task & {
  /**
   * True when nothing changed because the task was already completed (or,
   * for a recurring task, already advanced past now).
   */
  alreadyDone: boolean;
};
