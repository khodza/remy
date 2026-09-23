import type { Priority, Recurrence } from '@domain/task';

/** One task read from text, for the user to review; nothing is saved. */
export type ParsedTaskDraft = {
  description: string;
  notes: string | null;
  /** Null = no time given → a todo in the Inbox. */
  scheduledAt: Date | null;
  /** A date with no time (always false for a todo). */
  allDay: boolean;
  recurrence: Omit<Recurrence, 'anchorAt'> | null;
  priority: Priority;
  categoryId: string | null;
  leadMinutes: number | null;
  /** Named list, normalised; null if none. */
  list: string | null;
};

export type ParseTaskInput = { userId: string; text: string; now?: Date };

export type ParseLinesInput = { userId: string; lines: string[]; now?: Date };
