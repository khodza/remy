import { Schema } from 'mongoose';
import { TaskDocument } from './document';

const RecurrenceSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        'daily',
        'weekdays',
        'weekly',
        'monthly',
        'every_n_days',
        'yearly',
      ],
      required: true,
    },
    intervalDays: { type: Number, required: false, min: 1 },
    interval: { type: Number, required: false, min: 1 },
    // `default: undefined` stops Mongoose from materialising an empty array.
    byWeekday: { type: [Number], required: false, default: undefined },
    lastDayOfMonth: { type: Boolean, required: false },
    until: { type: Date, required: false },
    count: { type: Number, required: false, min: 1 },
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
    all_day: { type: Boolean, default: false },
    list: { type: String, default: null },
    snoozed_until: { type: Date, required: false, default: null },
    next_fire_at: { type: Date, required: false, default: null },
    next_attempt_at: { type: Date, required: false, default: null },
    lead_minutes: { type: Number, default: null, min: 1 },
    lead_sent_for: { type: Date, default: null },
    due_at: { type: Date, default: null },
    nudge_at: { type: Date, default: null },
    nudge_count: { type: Number, default: 0 },
    snooze_count: { type: Number, default: 0 },
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
    // Set while status is 'deleted'; Mongo purges the task 30 days later.
    deleted_at: { type: Date, default: null },
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
// Mini App views and chat queries filter on the due time, not on the
// scheduler's internal fire time (a heads-up or a nudge).
TaskSchema.index({ user_id: 1, status: 1, due_at: 1 });
TaskSchema.index({ user_id: 1, status: 1, completed_at: -1 });
// Named lists: GET /tasks?list= and GET /lists.
TaskSchema.index({ user_id: 1, list: 1 });
/** Soft-deleted tasks are purged this long after the delete (B29). */
export const DELETED_TASK_TTL_SECONDS = 30 * 24 * 60 * 60;
// TTL: only documents whose deleted_at is a date expire; null never does,
// and restoring a task (Undo) clears it.
TaskSchema.index(
  { deleted_at: 1 },
  { expireAfterSeconds: DELETED_TASK_TTL_SECONDS },
);
