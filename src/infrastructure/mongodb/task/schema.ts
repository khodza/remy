import { Schema } from 'mongoose';
import { TaskDocument } from './document';

const RecurrenceSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['daily', 'weekdays', 'weekly', 'monthly', 'every_n_days'],
      required: true,
    },
    intervalDays: { type: Number, required: false, min: 1 },
  },
  { _id: false },
);

export const TaskSchema = new Schema<TaskDocument>(
  {
    user_id: { type: String, required: true, index: true },
    telegram_chat_id: { type: Number, required: true },
    description: { type: String, required: true },
    scheduled_at: { type: Date, required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'completed', 'overdue', 'deleted'],
      index: true,
    },
    recurrence: { type: RecurrenceSchema, required: false, default: null },
    last_sent_at: { type: Date, required: false }, // Track when reminder was last sent
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'tasks',
  },
);

// Compound index for efficient reminder queries
TaskSchema.index({ status: 1, scheduled_at: 1 });
