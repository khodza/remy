import type { Recurrence } from '@domain/task';

export type SendReminderInput = {
  chatId: number;
  taskId: string;
  description: string;
  /**
   * 'due' = the reminder itself; 'heads_up' = the "remind me before" ping
   * that precedes it; 'nudge' = "still open", the reminder was ignored.
   */
  kind: 'due' | 'heads_up' | 'nudge';
  /** For nudges: 1 for the first "still open", 2 for the second… */
  nudgeNumber?: number;
  /** When the task is due (snoozes included). */
  dueAt: Date;
  /** A date without a time: shown as the date only. */
  allDay?: boolean;
  /** IANA zone used to format times. */
  timezone: string;
  notes?: string | null;
  recurrence?: Recurrence | null;
  /** Shown as a quote so the user remembers why (forwarded messages). */
  sourceQuote?: { text: string; from: string | null } | null;
};

/** A voice message (OGG/Opus) in the chat, e.g. the spoken brief. */
export type SendVoiceInput = {
  chatId: number;
  audio: Buffer;
  /** Short HTML caption under the bubble. */
  caption?: string;
};

/** A text file sent to the chat as a document (exports). */
export type SendDocumentInput = {
  chatId: number;
  filename: string;
  content: string;
  caption: string;
};

export type SentReminder = {
  /** Telegram message id, so replies to the reminder can be linked to the task. */
  messageId: number | null;
};

/**
 * A short bot message that replies to the message a task came from, so the
 * user can tap the quote and jump to it in the chat.
 */
export type SendSourceLinkInput = {
  chatId: number;
  /** The task's source.messageId. */
  replyToMessageId: number;
  /** The task title, for the text of the reply. */
  description: string;
};
