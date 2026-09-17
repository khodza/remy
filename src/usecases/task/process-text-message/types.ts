export type ProcessTextMessageInput = {
  userId: string;
  telegramChatId: number;
  text: string;
  userTimezone?: string;
};

import type { Recurrence } from '@domain/task';

export type ProcessTextMessageOutput = {
  taskId: string;
  description: string;
  scheduledAt: Date;
  recurrence: Recurrence | null;
};
