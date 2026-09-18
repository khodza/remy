import type { Recurrence, TaskSourceType } from '@domain/task';

export type ProcessTextMessageInput = {
  userId: string;
  telegramChatId: number;
  text: string;
  userTimezone?: string;
  /** Where the text came from. Defaults to a chat text message. */
  source?: {
    type: TaskSourceType;
    messageId?: number;
    forwardedFrom?: string;
  };
};

export type ProcessTextMessageOutput = {
  taskId: string;
  description: string;
  scheduledAt: Date;
  timezone: string;
  recurrence: Recurrence | null;
};
