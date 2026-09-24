import { Schema } from 'mongoose';
import type { GoogleConnectionDocument } from './document';

export const GOOGLE_CONNECTIONS_COLLECTION = 'google_connections';

export const GoogleConnectionSchema = new Schema<GoogleConnectionDocument>(
  {
    // `unique` creates the index: one Google account per Remy user.
    user_id: { type: String, required: true, unique: true },
    email: { type: String, default: null },
    refresh_token_enc: { type: String, required: true },
    access_token_enc: { type: String, default: null },
    access_token_expires_at: { type: Date, default: null },
    selected_calendar_ids: { type: [String], default: [] },
    connected_at: { type: Date, required: true },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: GOOGLE_CONNECTIONS_COLLECTION,
  },
);
