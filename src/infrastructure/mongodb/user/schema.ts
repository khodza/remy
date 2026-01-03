import { Schema } from 'mongoose';
import { UserDocument } from './document';

export const UserSchema = new Schema<UserDocument>(
  {
    telegram_user_id: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    first_name: { type: String, required: true },
    last_name: { type: String, default: null },
    username: { type: String, default: null },
    timezone: { type: String, default: null },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  },
);
