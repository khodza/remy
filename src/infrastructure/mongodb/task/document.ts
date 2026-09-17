import { Types, HydratedDocument } from 'mongoose';

export type RecurrenceSubdoc = {
  type: string;
  intervalDays?: number;
  anchorAt?: Date;
};

export type TaskDocument = {
  _id: Types.ObjectId;
  user_id: string;
  telegram_chat_id: number;
  description: string;
  scheduled_at: Date;
  /** Missing on documents created before Phase 1; backfilled at boot. */
  timezone?: string;
  snoozed_until?: Date | null;
  /** Missing on documents created before Phase 1; backfilled at boot. */
  next_fire_at?: Date;
  next_attempt_at?: Date | null;
  status: string;
  recurrence?: RecurrenceSubdoc | null;
  last_sent_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type TaskHydratedDocument = HydratedDocument<TaskDocument>;
