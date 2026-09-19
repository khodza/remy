import { Schema } from 'mongoose';
import { UserDocument } from './document';

export const UserSchema = new Schema<UserDocument>(
  {
    // `unique` already creates the index.
    telegram_user_id: { type: Number, required: true, unique: true },
    first_name: { type: String, required: true },
    last_name: { type: String, default: null },
    username: { type: String, default: null },
    timezone: { type: String, default: null },
    last_brief_on: { type: String, default: null },
    last_review_on: { type: String, default: null },
    last_wrap_on: { type: String, default: null },
    settings: { type: Schema.Types.Mixed, default: null },
    categories: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            name: { type: String, required: true },
            emoji: { type: String, required: true },
            color: { type: String, required: true },
            keywords: { type: [String], default: [] },
          },
          { _id: false },
        ),
      ],
      default: null,
    },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  },
);
