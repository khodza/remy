import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  TaskRepository,
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus,
  Recurrence,
  ClaimedReminder,
  TaskFilter,
  TaskSource,
  Priority,
  isScheduled,
} from '@domain/task/repository';
import { TaskDocument, RecurrenceSubdoc, SourceSubdoc } from './document';
import { Collections } from '../collections';
import {
  TaskNotFoundError,
  FailedToCreateTaskError,
  FailedToUpdateTaskError,
} from '@domain/task/errors';
import { ApplicationError } from '@domain/error';
import { getEnv } from '@common/config';

const LEGACY_TIMEZONE_FALLBACK = 'UTC';
const LEGACY_SOURCE: TaskSource = {
  type: 'text',
  originalText: null,
  messageId: null,
  forwardedFrom: null,
};

@Injectable()
export class TaskRepositoryImpl implements TaskRepository, OnModuleInit {
  private readonly logger = new Logger(TaskRepositoryImpl.name);

  constructor(
    @InjectModel(Collections.Tasks)
    private readonly model: Model<TaskDocument>,
  ) {}

  /**
   * Backfill fields that queries filter or sort on, for documents that
   * predate them. Everything else gets its default in documentToEntity.
   * Idempotent and cheap (no-op once run).
   */
  public async onModuleInit(): Promise<void> {
    // Each step stands alone: one failing must not block the others, and a
    // failure here must never stop the app from booting.
    const step = async (
      name: string,
      run: () => Promise<{ modifiedCount: number }>,
    ): Promise<void> => {
      try {
        const { modifiedCount } = await run();
        if (modifiedCount > 0) {
          this.logger.log(`Backfilled ${name} on ${modifiedCount} task(s)`);
        }
      } catch (error) {
        this.logger.error(`Task backfill "${name}" failed`, error as Error);
      }
    };

    // Mongoose 9 refuses aggregation-pipeline updates unless asked to.
    await step('next_fire_at', () =>
      this.model.updateMany(
        { next_fire_at: { $exists: false } },
        [
          {
            $set: {
              next_fire_at: { $ifNull: ['$snoozed_until', '$scheduled_at'] },
            },
          },
        ],
        { updatePipeline: true, timestamps: false },
      ),
    );
    await step('timezone', () =>
      this.model.updateMany(
        { timezone: { $exists: false } },
        {
          $set: {
            timezone: getEnv().OWNER_TIMEZONE ?? LEGACY_TIMEZONE_FALLBACK,
          },
        },
        { timestamps: false },
      ),
    );
    // The Done view sorts and filters on completed_at.
    await step('completed_at', () =>
      this.model.updateMany(
        {
          status: TaskStatus.Completed,
          $or: [{ completed_at: { $exists: false } }, { completed_at: null }],
        },
        [{ $set: { completed_at: '$updated_at' } }],
        { updatePipeline: true, timestamps: false },
      ),
    );
  }

  public async create(params: CreateTaskParams): Promise<Task> {
    try {
      const doc = await this.model.create({
        user_id: params.userId,
        telegram_chat_id: params.telegramChatId,
        description: params.description,
        notes: params.notes ?? null,
        scheduled_at: params.scheduledAt,
        timezone: params.timezone,
        snoozed_until: null,
        next_fire_at: params.scheduledAt,
        next_attempt_at: null,
        lead_minutes: params.leadMinutes ?? null,
        status: TaskStatus.Pending,
        priority: params.priority ?? 'normal',
        category_id: params.categoryId ?? null,
        recurrence: recurrenceToSubdoc(params.recurrence ?? null),
        source: sourceToSubdoc(params.source),
        completed_at: null,
        completions: [],
        last_sent_at: null,
      });
      return this.documentToEntity(doc);
    } catch (error) {
      throw new FailedToCreateTaskError('Failed to create task', error);
    }
  }

  public async findById(id: string): Promise<Task | null> {
    const doc = await this.model.findById(id);
    return doc ? this.documentToEntity(doc) : null;
  }

  public async findByUserId(
    userId: string,
    status?: TaskStatus,
  ): Promise<Task[]> {
    const filter: Record<string, unknown> = { user_id: userId };
    if (status !== undefined) {
      filter['status'] = status;
    }
    const docs = await this.model.find(filter).sort({ scheduled_at: 1 });
    return docs.map((doc) => this.documentToEntity(doc));
  }

  public async find(filter: TaskFilter): Promise<Task[]> {
    const query: Record<string, unknown> = {
      user_id: filter.userId,
      status: { $in: filter.statuses },
    };
    if (filter.kind === 'todo') query['scheduled_at'] = null;
    if (filter.kind === 'reminder') query['scheduled_at'] = { $ne: null };

    const fire: Record<string, Date> = {};
    if (filter.fireAtOrBefore) fire['$lte'] = filter.fireAtOrBefore;
    if (filter.fireAfter) fire['$gt'] = filter.fireAfter;
    if (Object.keys(fire).length > 0) query['next_fire_at'] = fire;

    if (filter.completedAtOrAfter) {
      query['completed_at'] = { $gte: filter.completedAtOrAfter };
    }

    const sort: Record<string, 1 | -1> =
      filter.sort === 'completedAtDesc'
        ? { completed_at: -1 }
        : filter.sort === 'createdAtDesc'
          ? { created_at: -1 }
          : { next_fire_at: 1, created_at: 1 };

    let cursor = this.model.find(query).sort(sort);
    if (filter.limit !== undefined) cursor = cursor.limit(filter.limit);
    const docs = await cursor;
    return docs.map((doc) => this.documentToEntity(doc));
  }

  public async clearCategory(
    userId: string,
    categoryId: string,
  ): Promise<void> {
    await this.model.updateMany(
      { user_id: userId, category_id: categoryId },
      { $set: { category_id: null } },
    );
  }

  public async claimDueReminder(now: Date): Promise<ClaimedReminder | null> {
    // One reminder per fire time: due again only once next_fire_at moves
    // past the last send (delay, edit, recurrence rollover). A null
    // last_sent_at compares lower than any date, so never-sent tasks match.
    // findOneAndUpdate is atomic, so a second run (or replica) can't claim
    // the same task; we get the pre-claim document back to allow a release.
    // Todos have next_fire_at null and never match $lte.
    const before = await this.model.findOneAndUpdate(
      {
        status: TaskStatus.Pending,
        next_fire_at: { $lte: now },
        $expr: { $lt: ['$last_sent_at', '$next_fire_at'] },
        $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
      },
      { $set: { last_sent_at: now, next_attempt_at: null } },
      { new: false, sort: { next_fire_at: 1 } },
    );
    if (!before) return null;
    const task = this.documentToEntity(before);
    if (!isScheduled(task)) return null; // unreachable given the query
    return {
      task: { ...task, lastSentAt: now, nextAttemptAt: null },
      previousLastSentAt: task.lastSentAt,
    };
  }

  public async releaseReminderClaim(
    id: string,
    previousLastSentAt: Date | undefined,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      {
        $set: {
          last_sent_at: previousLastSentAt ?? null,
          next_attempt_at: nextAttemptAt,
        },
      },
    );
  }

  public async findOverdueRecurring(beforeDate: Date): Promise<Task[]> {
    const docs = await this.model.find({
      status: TaskStatus.Pending,
      scheduled_at: { $ne: null, $lte: beforeDate },
      recurrence: { $ne: null },
    });
    return docs.map((doc) => this.documentToEntity(doc));
  }

  public async update(params: UpdateTaskParams): Promise<Task> {
    try {
      const set: Record<string, unknown> = {};
      if (params.description !== undefined)
        set['description'] = params.description;
      if (params.notes !== undefined) set['notes'] = params.notes;
      if (params.scheduledAt !== undefined)
        set['scheduled_at'] = params.scheduledAt;
      if (params.timezone !== undefined) set['timezone'] = params.timezone;
      if (params.snoozedUntil !== undefined)
        set['snoozed_until'] = params.snoozedUntil;
      if (params.nextAttemptAt !== undefined)
        set['next_attempt_at'] = params.nextAttemptAt;
      if (params.leadMinutes !== undefined)
        set['lead_minutes'] = params.leadMinutes;
      if (params.status !== undefined) set['status'] = params.status;
      if (params.priority !== undefined) set['priority'] = params.priority;
      if (params.categoryId !== undefined)
        set['category_id'] = params.categoryId;
      if (params.completedAt !== undefined)
        set['completed_at'] = params.completedAt;
      if (params.lastSentAt !== undefined)
        set['last_sent_at'] = params.lastSentAt;
      if (params.recurrence !== undefined)
        set['recurrence'] = recurrenceToSubdoc(params.recurrence);

      // next_fire_at is derived; recompute whenever either input changes.
      if (
        params.scheduledAt !== undefined ||
        params.snoozedUntil !== undefined
      ) {
        const existing = await this.model.findById(params.id);
        if (!existing) {
          throw new TaskNotFoundError(`Task with id ${params.id} not found`);
        }
        const scheduledAt =
          params.scheduledAt !== undefined
            ? params.scheduledAt
            : existing.scheduled_at;
        const snoozedUntil =
          params.snoozedUntil !== undefined
            ? params.snoozedUntil
            : (existing.snoozed_until ?? null);
        // A todo (no scheduledAt) never fires, whatever the snooze says.
        set['next_fire_at'] =
          scheduledAt === null ? null : (snoozedUntil ?? scheduledAt);
      }

      const update: Record<string, unknown> = { $set: set };
      if (params.pushCompletion) {
        update['$push'] = {
          completions: {
            at: params.pushCompletion.at,
            occurrence_at: params.pushCompletion.occurrenceAt,
          },
        };
      }

      const doc = await this.model.findByIdAndUpdate(params.id, update, {
        new: true,
      });
      if (!doc) {
        throw new TaskNotFoundError(`Task with id ${params.id} not found`);
      }
      return this.documentToEntity(doc);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToUpdateTaskError('Failed to update task', error);
    }
  }

  public async delete(id: string): Promise<void> {
    const result = await this.model.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new TaskNotFoundError(`Task with id ${id} not found`);
    }
  }

  private documentToEntity(document: TaskDocument): Task {
    const scheduledAt = document.scheduled_at ?? null;
    const snoozedUntil = document.snoozed_until ?? null;
    const nextFireAt =
      scheduledAt === null
        ? null
        : (document.next_fire_at ?? snoozedUntil ?? scheduledAt);
    return {
      id: document._id.toHexString(),
      userId: document.user_id,
      telegramChatId: document.telegram_chat_id,
      description: document.description,
      notes: document.notes ?? null,
      kind: scheduledAt === null ? 'todo' : 'reminder',
      scheduledAt,
      timezone: document.timezone ?? LEGACY_TIMEZONE_FALLBACK,
      snoozedUntil,
      nextFireAt,
      nextAttemptAt: document.next_attempt_at ?? null,
      leadMinutes: document.lead_minutes ?? null,
      status: document.status as TaskStatus,
      priority: (document.priority as Priority | undefined) ?? 'normal',
      categoryId: document.category_id ?? null,
      recurrence: subdocToRecurrence(document.recurrence),
      source: subdocToSource(document.source),
      completedAt: document.completed_at ?? null,
      completions: (document.completions ?? []).map((c) => ({
        at: c.at,
        occurrenceAt: c.occurrence_at,
      })),
      lastSentAt: document.last_sent_at ?? undefined,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    };
  }
}

function recurrenceToSubdoc(
  recurrence: Recurrence | null | undefined,
): RecurrenceSubdoc | null {
  if (!recurrence) return null;
  const doc: RecurrenceSubdoc = { type: recurrence.type };
  if (recurrence.intervalDays !== undefined) {
    doc.intervalDays = recurrence.intervalDays;
  }
  if (recurrence.anchorAt !== undefined) doc.anchorAt = recurrence.anchorAt;
  return doc;
}

function subdocToRecurrence(
  subdoc: RecurrenceSubdoc | null | undefined,
): Recurrence | null {
  if (!subdoc) return null;
  const { type, intervalDays, anchorAt } = subdoc;
  const recurrence: Recurrence = { type: type as Recurrence['type'] };
  if (typeof intervalDays === 'number') recurrence.intervalDays = intervalDays;
  if (anchorAt instanceof Date) recurrence.anchorAt = anchorAt;
  return recurrence;
}

function sourceToSubdoc(source: TaskSource): SourceSubdoc {
  return {
    type: source.type,
    original_text: source.originalText,
    message_id: source.messageId,
    forwarded_from: source.forwardedFrom,
  };
}

function subdocToSource(subdoc: SourceSubdoc | null | undefined): TaskSource {
  if (!subdoc) return { ...LEGACY_SOURCE };
  return {
    type: subdoc.type as TaskSource['type'],
    originalText: subdoc.original_text ?? null,
    messageId: subdoc.message_id ?? null,
    forwardedFrom: subdoc.forwarded_from ?? null,
  };
}
