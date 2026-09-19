import { Schema } from 'mongoose';

/** Which tasks a bot message is about. Expires after 45 days. */
export const BotMessageSchema = new Schema(
  {
    chat_id: { type: Number, required: true },
    message_id: { type: Number, required: true },
    task_ids: { type: [String], required: true },
    kind: { type: String, required: true },
    created_at: {
      type: Date,
      default: () => new Date(),
      expires: 45 * 24 * 60 * 60,
    },
  },
  { versionKey: false, collection: 'bot_messages' },
);
BotMessageSchema.index({ chat_id: 1, message_id: 1 }, { unique: true });

/** One document per chat: short-lived conversational context. */
export const ConversationSchema = new Schema(
  {
    chat_id: { type: Number, required: true, unique: true },
    pending_question: { type: Schema.Types.Mixed, default: null },
    pending_forward: { type: Schema.Types.Mixed, default: null },
    last_task_ids: { type: [String], default: [] },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'conversations',
  },
);

/** Snapshots for the Undo button. Mongo removes them a day after expiry. */
export const UndoRecordSchema = new Schema(
  {
    chat_id: { type: Number, required: true },
    user_id: { type: String, required: true },
    label: { type: String, required: true },
    snapshots: { type: [Schema.Types.Mixed], default: [] },
    created_task_ids: { type: [String], default: [] },
    expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null },
    created_at: {
      type: Date,
      default: () => new Date(),
      expires: 24 * 60 * 60,
    },
  },
  { versionKey: false, collection: 'undo_records' },
);
