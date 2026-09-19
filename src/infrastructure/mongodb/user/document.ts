import { Types, HydratedDocument } from 'mongoose';
import type { Category, UserSettings } from '@domain/user';

export type UserDocument = {
  _id: Types.ObjectId;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  timezone: string | null;
  /** Stored as the domain shape; missing keys fall back to defaults on read. */
  settings?: Partial<UserSettings> | null;
  categories?: Category[] | null;
  calendar_token?: string | null;
  /** Local dates (YYYY-MM-DD) the digests were last sent for. */
  last_brief_on?: string | null;
  last_review_on?: string | null;
  last_wrap_on?: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserHydratedDocument = HydratedDocument<UserDocument>;
