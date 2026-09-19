import type { Recurrence } from '@domain/task';

export type SendReminderInput = {
  chatId: number;
  taskId: string;
  description: string;
  /**
   * 'due' = the reminder itself; 'heads_up' = the "remind me before" ping
   * that precedes it.
   */
  kind: 'due' | 'heads_up';
  /** When the task is due (snoozes included). */
  dueAt: Date;
  /** IANA zone used to format times. */
  timezone: string;
  notes?: string | null;
  recurrence?: Recurrence | null;
  /** Shown as a quote so the user remembers why (forwarded messages). */
  sourceQuote?: { text: string; from: string | null } | null;
};

export type SentReminder = {
  /** Telegram message id, so replies to the reminder can be linked to the task. */
  messageId: number | null;
};
