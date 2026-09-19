import { Types, HydratedDocument } from 'mongoose';

export type RecurrenceSubdoc = {
  type: string;
  intervalDays?: number;
  interval?: number;
  byWeekday?: number[];
  lastDayOfMonth?: boolean;
  until?: Date;
  anchorAt?: Date;
};

export type SourceSubdoc = {
  type: string;
  original_text?: string | null;
  message_id?: number | null;
  forwarded_from?: string | null;
};

export type CompletionSubdoc = { at: Date; occurrence_at: Date };

/**
 * Fields added after the first release are optional here: old documents
 * lack them and `documentToEntity` fills in defaults. Only fields that the
 * scheduler or the view queries filter on are backfilled at boot.
 */
export type TaskDocument = {
  _id: Types.ObjectId;
  user_id: string;
  telegram_chat_id: number;
  description: string;
  notes?: string | null;
  /** Null for todos. */
  scheduled_at: Date | null;
  timezone?: string;
  snoozed_until?: Date | null;
  next_fire_at?: Date | null;
  next_attempt_at?: Date | null;
  lead_minutes?: number | null;
  lead_sent_for?: Date | null;
  status: string;
  priority?: string;
  category_id?: string | null;
  recurrence?: RecurrenceSubdoc | null;
  source?: SourceSubdoc | null;
  completed_at?: Date | null;
  completions?: CompletionSubdoc[];
  last_sent_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type TaskHydratedDocument = HydratedDocument<TaskDocument>;
