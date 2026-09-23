import type { Priority, Recurrence } from '@domain/task';

/** One task the user asked for, already converted to absolute time. */
export type TaskDraft = {
  title: string;
  /** Null = no time given → a todo in the Inbox. */
  dueAt: Date | null;
  recurrence: Omit<Recurrence, 'anchorAt'> | null;
  priority: Priority;
  /** One of the user's category names, when the model recognised one. */
  categoryName: string | null;
  leadMinutes: number | null;
  notes: string | null;
};

export type QueryRange =
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'overdue'
  | 'inbox'
  | 'all';

/** What the user meant. Exactly one of these per message. */
export type Interpretation =
  | { intent: 'create'; tasks: TaskDraft[] }
  | { intent: 'query'; range: QueryRange; search: string | null }
  | { intent: 'complete'; targetIds: string[] }
  | {
      intent: 'reschedule';
      targetIds: string[];
      /** Absolute new time (one target, or all targets to the same time)… */
      dueAt: Date | null;
      /** …or a relative shift that keeps each task's time of day. */
      shiftMinutes: number | null;
    }
  | { intent: 'delete'; targetIds: string[] }
  | {
      intent: 'edit';
      targetId: string;
      title: string | null;
      notes: string | null;
    }
  | { intent: 'chat'; reply: string }
  | { intent: 'unclear'; question: string; options: string[] };

export type CandidateTask = {
  id: string;
  title: string;
  /** Effective due time (snooze included); null for todos. */
  dueAt: Date | null;
  recurring: boolean;
};

export type InterpreterInput = {
  text: string;
  timezone: string;
  now: Date;
  /** The user's open tasks, so "the dentist" can be resolved to an id. */
  candidates: CandidateTask[];
  /** Names of the user's categories. */
  categories: string[];
  /** Tasks the message the user replied to is about ("make it 11"). */
  replyToTaskIds: string[];
  /** Tasks Remy last touched: what "it" refers to without a reply. */
  lastTaskIds: string[];
  /** Remy asked a question last turn; this message is probably the answer. */
  pendingQuestion: {
    /** The first message of the exchange: the thing actually being asked for. */
    originalText: string;
    question: string;
    /** Questions of this exchange that were already answered, oldest first. */
    answered: { question: string; answer: string }[];
  } | null;
  /** A forwarded / replied-to message the user wants to be reminded about. */
  quoted: { text: string; from: string | null } | null;
};
