import type { Recurrence, TaskStatus } from '@domain/task';

/** A bot message that is "about" some tasks, so a reply to it can act on them. */
export type MessageLink = {
  chatId: number;
  messageId: number;
  taskIds: string[];
  kind: 'reminder' | 'confirmation' | 'agenda';
};

/** Something the user said that Remy could not act on without one more answer. */
export type PendingQuestion = {
  originalText: string;
  question: string;
  options: string[];
  askedAt: Date;
};

/** A forwarded message waiting for the user to say when to be reminded. */
export type PendingForward = {
  text: string;
  forwardedFrom: string | null;
  messageId: number;
  receivedAt: Date;
};

export type ConversationState = {
  chatId: number;
  pendingQuestion: PendingQuestion | null;
  pendingForward: PendingForward | null;
  /** Tasks Remy last created or touched: what "it" / "that" refers to. */
  lastTaskIds: string[];
};

/** Everything needed to put a task back the way it was. */
export type TaskSnapshot = {
  taskId: string;
  status: TaskStatus;
  description: string;
  notes: string | null;
  scheduledAt: Date | null;
  snoozedUntil: Date | null;
  completedAt: Date | null;
  recurrence: Recurrence | null;
  completionsCount: number;
};

export type UndoRecord = {
  id: string;
  chatId: number;
  userId: string;
  /** Shown in the toast: "Undid: moved Dentist". */
  label: string;
  /** Tasks that existed before the action, restored from these. */
  snapshots: TaskSnapshot[];
  /** Tasks the action created; undo deletes them. */
  createdTaskIds: string[];
  expiresAt: Date;
};

export type NewUndoRecord = Omit<UndoRecord, 'id'>;
