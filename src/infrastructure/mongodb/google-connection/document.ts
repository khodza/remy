import type { HydratedDocument, Types } from 'mongoose';

/** One connected Google account per user. Tokens are sealed by TokenCipher. */
export type GoogleConnectionDocument = {
  _id: Types.ObjectId;
  user_id: string;
  email: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_expires_at: Date | null;
  selected_calendar_ids: string[];
  connected_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type GoogleConnectionHydratedDocument =
  HydratedDocument<GoogleConnectionDocument>;
