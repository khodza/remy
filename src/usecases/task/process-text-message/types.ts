import type { Task, TaskSourceType } from '@domain/task';

export type ProcessTextMessageInput = {
  userId: string;
  telegramChatId: number;
  text: string;
  /** Zone the tasks are created in (the user's zone, OWNER_TIMEZONE fallback). */
  timezone: string;
  /** Where the text came from. Defaults to the Mini App. */
  sourceType?: TaskSourceType;
  now?: Date;
};

export type ProcessTextMessageOutput = {
  /** Every task the text held, in order; at least one. */
  tasks: Task[];
};
