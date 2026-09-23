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
  ListSummary,
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
import { deriveNextFireAt } from '@common/fire-time';

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
    // Views filter on due_at (Phase 4). `$exists: false` only: a todo
    // legitimately has due_at null.
    await step('due_at', () =>
      this.model.updateMany(
        { due_at: { $exists: false } },
        [
          {
            $set: { due_at: { $ifNull: ['$snoozed_until', '$scheduled_at'] } },
          },
        ],
        { updatePipeline: true, timestamps: false },
      ),
    );
    // Contract 2.4.0 fields. all_day / list read back as false / null
    // anyway; writing them keeps every document the same shape.
    await step('all_day', () =>
      this.model.updateMany(
        { all_day: { $exists: false } },
        { $set: { all_day: false } },
        { timestamps: false },
      ),
    );
    await step('list', () =>
      this.model.updateMany(
        { list: { $exists: false } },
        { $set: { list: null } },
        { timestamps: false },
      ),
    );
    // Tasks deleted before the purge existed start their 30 days from their
    // last change, so old deletions go on the first TTL pass after that.
    await step('deleted_at', () =>
      this.model.updateMany(
        {
          status: TaskStatus.Deleted,
          $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
        },
        [{ $set: { deleted_at: '$updated_at' } }],
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
        all_day: params.scheduledAt !== null && (params.allDay ?? false),
        list: params.list ?? null,
        snoozed_until: null,
        next_fire_at: deriveNextFireAt({
          scheduledAt: params.scheduledAt,
          snoozedUntil: null,
          leadMinutes: params.leadMinutes ?? null,
          leadSentFor: null,
        }),
        next_attempt_at: null,
        lead_minutes: params.leadMinutes ?? null,
        lead_sent_for: null,
        due_at: params.scheduledAt,
        nudge_at: null,
        nudge_count: 0,
        snooze_count: 0,
        status: TaskStatus.Pending,
        priority: params.priority ?? 'normal',
        category_id: params.categoryId ?? null,
        recurrence: recurrenceToSubdoc(params.recurrence ?? null),
        source: sourceToSubdoc(params.source),
        completed_at: null,
        completions: [],
        last_sent_at: null,
        deleted_at: null,
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

    const due: Record<string, Date> = {};
    if (filter.dueAtOrBefore) due['$lte'] = filter.dueAtOrBefore;
    if (filter.dueAfter) due['$gt'] = filter.dueAfter;
    if (Object.keys(due).length > 0) query['due_at'] = due;
    if (filter.updatedAtOrAfter) {
      query['updated_at'] = { $gte: filter.updatedAtOrAfter };
    }

    if (filter.completedAtOrAfter) {
      query['completed_at'] = { $gte: filter.completedAtOrAfter };
    }
    if (filter.list !== undefined) query['list'] = filter.list;
    const words = (filter.search ?? []).filter((w) => w.trim() !== '');
    if (words.length > 0) {
      // Every word somewhere in the title, the notes or the list name.
      query['$and'] = words.map((word) => {
        const pattern = { $regex: escapeRegex(word.trim()), $options: 'i' };
        return {
          $or: [
            { description: pattern },
            { notes: pattern },
            { list: pattern },
          ],
        };
      });
    }

    const sort: Record<string, 1 | -1> =
      filter.sort === 'completedAtDesc'
        ? { completed_at: -1 }
        : filter.sort === 'createdAtDesc'
          ? { created_at: -1 }
          : { due_at: 1, created_at: 1 };

    let cursor = this.model.find(query).sort(sort);
    if (filter.limit !== undefined) cursor = cursor.limit(filter.limit);
    const docs = await cursor;
    return docs.map((doc) => this.documentToEntity(doc));
  }

  public async listSummaries(userId: string): Promise<ListSummary[]> {
    const rows = await this.model.aggregate<{
      _id: string;
      pending: number;
      completed: number;
    }>([
      {
        $match: {
          user_id: userId,
          status: { $in: [TaskStatus.Pending, TaskStatus.Completed] },
          list: { $type: 'string' },
        },
      },
      {
        $group: {
          _id: '$list',
          pending: {
            $sum: { $cond: [{ $eq: ['$status', TaskStatus.Pending] }, 1, 0] },
          },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', TaskStatus.Completed] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({
      name: r._id,
      pending: r.pending,
      completed: r.completed,
    }));
  }

  public async deleteAllForUser(userId: string): Promise<number> {
    const { deletedCount } = await this.model.deleteMany({ user_id: userId });
    return deletedCount;
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
      if (params.leadSentFor !== undefined)
        set['lead_sent_for'] = params.leadSentFor;
      if (params.nudgeAt !== undefined) set['nudge_at'] = params.nudgeAt;
      if (params.nudgeCount !== undefined)
        set['nudge_count'] = params.nudgeCount;
      if (params.snoozeCount !== undefined && !params.incrementSnoozeCount)
        set['snooze_count'] = params.snoozeCount;
      if (params.status !== undefined) {
        set['status'] = params.status;
        // Starts (or, on a restore, stops) the 30-day purge clock.
        set['deleted_at'] =
          params.status === TaskStatus.Deleted ? new Date() : null;
      }
      if (params.allDay !== undefined) set['all_day'] = params.allDay;
      if (params.list !== undefined) set['list'] = params.list;
      if (params.priority !== undefined) set['priority'] = params.priority;
      if (params.categoryId !== undefined)
        set['category_id'] = params.categoryId;
      if (params.completedAt !== undefined)
        set['completed_at'] = params.completedAt;
      if (params.lastSentAt !== undefined)
        set['last_sent_at'] = params.lastSentAt;
      if (params.recurrence !== undefined)
        set['recurrence'] = recurrenceToSubdoc(params.recurrence);

      // A new time or a snooze starts a fresh occurrence: no nudges yet.
      const timeChanged =
        params.scheduledAt !== undefined || params.snoozedUntil !== undefined;
      if (timeChanged && params.nudgeAt === undefined) {
        set['nudge_at'] = null;
        set['nudge_count'] = 0;
      }

      // next_fire_at and due_at are derived; recompute whenever an input changes.
      if (
        timeChanged ||
        params.leadMinutes !== undefined ||
        params.leadSentFor !== undefined ||
        params.nudgeAt !== undefined
      ) {
        const existing = await this.model.findById(params.id);
        if (!existing) {
          throw new TaskNotFoundError(`Task with id ${params.id} not found`);
        }
        const pick = <T>(next: T | undefined, current: T): T =>
          next !== undefined ? next : current;
        const scheduledAt = pick(
          params.scheduledAt,
          existing.scheduled_at ?? null,
        );
        const snoozedUntil = pick(
          params.snoozedUntil,
          existing.snoozed_until ?? null,
        );
        const leadMinutes = pick(
          params.leadMinutes,
          existing.lead_minutes ?? null,
        );
        let leadSentFor = pick(
          params.leadSentFor,
          existing.lead_sent_for ?? null,
        );
        // A task moved to a time whose heads-up slot is already behind us
        // ("+15m" on a fired reminder with a 30 min lead) must skip the
        // heads-up: next_fire_at would land at or before last_sent_at and
        // the claim query would never match the task again.
        if (
          timeChanged &&
          params.leadSentFor === undefined &&
          scheduledAt !== null &&
          leadMinutes !== null &&
          leadMinutes > 0
        ) {
          const headsUpAt = scheduledAt.getTime() - leadMinutes * 60_000;
          const behindUs = Math.max(
            Date.now(),
            existing.last_sent_at?.getTime() ?? 0,
          );
          if (headsUpAt <= behindUs) {
            leadSentFor = scheduledAt;
            set['lead_sent_for'] = scheduledAt;
          }
        }
        set['next_fire_at'] = deriveNextFireAt({
          scheduledAt,
          snoozedUntil,
          leadMinutes,
          leadSentFor,
          nudgeAt:
            params.nudgeAt !== undefined
              ? params.nudgeAt
              : timeChanged
                ? null
                : (existing.nudge_at ?? null),
        });
        set['due_at'] =
          scheduledAt === null ? null : (snoozedUntil ?? scheduledAt);
      }

      const update: Record<string, unknown> = { $set: set };
      if (params.incrementSnoozeCount) update['$inc'] = { snooze_count: 1 };
      if (params.truncateCompletions !== undefined) {
        update['$push'] = {
          completions: { $each: [], $slice: params.truncateCompletions },
        };
      } else if (params.pushCompletion) {
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
      allDay: scheduledAt !== null && document.all_day === true,
      list: document.list ?? null,
      snoozedUntil,
      nextFireAt,
      nextAttemptAt: document.next_attempt_at ?? null,
      leadMinutes: document.lead_minutes ?? null,
      leadSentFor: document.lead_sent_for ?? null,
      nudgeAt: document.nudge_at ?? null,
      nudgeCount: document.nudge_count ?? 0,
      snoozeCount: document.snooze_count ?? 0,
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

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recurrenceToSubdoc(
  recurrence: Recurrence | null | undefined,
): RecurrenceSubdoc | null {
  if (!recurrence) return null;
  const doc: RecurrenceSubdoc = { type: recurrence.type };
  if (recurrence.intervalDays !== undefined)
    doc.intervalDays = recurrence.intervalDays;
  if (recurrence.interval !== undefined) doc.interval = recurrence.interval;
  if (recurrence.byWeekday !== undefined)
    doc.byWeekday = [...recurrence.byWeekday];
  if (recurrence.lastDayOfMonth !== undefined)
    doc.lastDayOfMonth = recurrence.lastDayOfMonth;
  if (recurrence.until !== undefined) doc.until = recurrence.until;
  if (recurrence.count !== undefined) doc.count = recurrence.count;
  if (recurrence.anchorAt !== undefined) doc.anchorAt = recurrence.anchorAt;
  return doc;
}

function subdocToRecurrence(
  subdoc: RecurrenceSubdoc | null | undefined,
): Recurrence | null {
  if (!subdoc) return null;
  const recurrence: Recurrence = { type: subdoc.type as Recurrence['type'] };
  if (typeof subdoc.intervalDays === 'number')
    recurrence.intervalDays = subdoc.intervalDays;
  if (typeof subdoc.interval === 'number')
    recurrence.interval = subdoc.interval;
  if (Array.isArray(subdoc.byWeekday) && subdoc.byWeekday.length > 0)
    recurrence.byWeekday = [...subdoc.byWeekday];
  if (subdoc.lastDayOfMonth === true) recurrence.lastDayOfMonth = true;
  if (subdoc.until instanceof Date) recurrence.until = subdoc.until;
  if (typeof subdoc.count === 'number') recurrence.count = subdoc.count;
  if (subdoc.anchorAt instanceof Date) recurrence.anchorAt = subdoc.anchorAt;
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
