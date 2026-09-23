import { Task } from '@domain/task';

export type MarkCompleteInput = {
  taskId: string;
  /**
   * The occurrence the user means (a recurring task's scheduledAt). With it
   * a Done that comes before the time ("✅" on the heads-up, "already took my
   * pills") advances the series; without it an early Done is treated as a
   * stale tap and ignored.
   */
  occurrenceAt?: Date;
};

export type MarkCompleteOutput = Task & {
  /**
   * True when nothing changed because the task was already completed (or,
   * for a recurring task, already advanced past now).
   */
  alreadyDone: boolean;
};
