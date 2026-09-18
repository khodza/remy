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
    anchorAt: { type: Date, required: false },
  },
  { _id: false },
);

const SourceSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['text', 'voice', 'forward', 'miniapp'],
      required: true,
    },
    original_text: { type: String, default: null },
    message_id: { type: Number, default: null },
    forwarded_from: { type: String, default: null },
  },
  { _id: false },
);

const CompletionSchema = new Schema(
  {
    at: { type: Date, required: true },
    occurrence_at: { type: Date, required: true },
  },
  { _id: false },
);

export const TaskSchema = new Schema<TaskDocument>(
  {
    user_id: { type: String, required: true, index: true },
    telegram_chat_id: { type: Number, required: true },
    description: { type: String, required: true },
    notes: { type: String, default: null },
    // Not `required`: a todo has no time.
    scheduled_at: { type: Date, default: null, index: true },
    timezone: { type: String, required: false },
    snoozed_until: { type: Date, required: false, default: null },
    next_fire_at: { type: Date, required: false, default: null },
    next_attempt_at: { type: Date, required: false, default: null },
    lead_minutes: { type: Number, default: null, min: 1 },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'completed', 'overdue', 'deleted'],
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal',
    },
    category_id: { type: String, default: null },
    recurrence: { type: RecurrenceSchema, required: false, default: null },
    source: { type: SourceSchema, required: false, default: null },
    completed_at: { type: Date, default: null },
    completions: { type: [CompletionSchema], default: [] },
    last_sent_at: { type: Date, required: false, default: null },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'tasks',
  },
);

// The scheduler's claim query.
TaskSchema.index({ status: 1, next_fire_at: 1 });
// Still used by findOverdueRecurring.
TaskSchema.index({ status: 1, scheduled_at: 1 });
// Mini App views: today/upcoming/inbox and the Done list.
TaskSchema.index({ user_id: 1, status: 1, next_fire_at: 1 });
TaskSchema.index({ user_id: 1, status: 1, completed_at: -1 });
