import type { Recurrence } from '@domain/task';

export type TaskParserInput = {
  text: string;
  userTimezone?: string;
};

export type TaskParserOutput = {
  description: string;
  scheduledAt: Date;
  /** Null when the user didn't ask for recurrence. */
  recurrence: Recurrence | null;
};
