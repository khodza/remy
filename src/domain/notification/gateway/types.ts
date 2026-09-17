import type { Recurrence } from '@domain/task';

export type SendReminderInput = {
  chatId: number;
  taskId: string;
  description: string;
  scheduledAt: Date;
  recurrence?: Recurrence | null;
};
