import type { Recurrence } from '@domain/task';

export type SendReminderInput = {
  chatId: number;
  taskId: string;
  description: string;
  /** The fire time to show (nextFireAt: snoozes included). */
  scheduledAt: Date;
  /** IANA zone used to format the time. */
  timezone: string;
  recurrence?: Recurrence | null;
};
