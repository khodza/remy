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
} from '@domain/task/repository';
import { TaskDocument, RecurrenceSubdoc } from './document';
import { Collections } from '../collections';
import {
  TaskNotFoundError,
  FailedToCreateTaskError,
  FailedToUpdateTaskError,
} from '@domain/task/errors';
import { ApplicationError } from '@domain/error';
import { getEnv } from '@common/config';

const LEGACY_TIMEZONE_FALLBACK = 'UTC';

@Injectable()
export class TaskRepositoryImpl implements TaskRepository, OnModuleInit {
  private readonly logger = new Logger(TaskRepositoryImpl.name);

  constructor(
    @InjectModel(Collections.Tasks)
    private readonly model: Model<TaskDocument>,
  ) {}

  /**
   * Backfill fields added in Phase 1 on documents that predate them, so the
   * scheduler's next_fire_at query and the timezone-aware formatting see
   * every task. Idempotent and cheap (no-op once run).
   */
  public async onModuleInit(): Promise<void> {
    try {
      const fire = await this.model.updateMany(
        { next_fire_at: { $exists: false } },
        [
          {
            $set: {
              next_fire_at: { $ifNull: ['$snoozed_until', '$scheduled_at'] },
            },
          },
        ],
      );
      const tz = await this.model.updateMany(
        { timezone: { $exists: false } },
        {
          $set: {
            timezone: getEnv().OWNER_TIMEZONE ?? LEGACY_TIMEZONE_FALLBACK,
          },
        },
      );
      if (fire.modifiedCount > 0 || tz.modifiedCount > 0) {
        this.logger.log(
          `Backfilled tasks: next_fire_at on ${fire.modifiedCount}, timezone on ${tz.modifiedCount}`,
        );
      }
    } catch (error) {
      this.logger.error('Task backfill failed', error as Error);
    }
  }

  public async create(params: CreateTaskParams): Promise<Task> {
    try {
      const doc = await this.model.create({
        user_id: params.userId,
        telegram_chat_id: params.telegramChatId,
        description: params.description,
        scheduled_at: params.scheduledAt,
        timezone: params.timezone,
        snoozed_until: null,
        next_fire_at: params.scheduledAt,
        next_attempt_at: null,
        status: TaskStatus.Pending,
        recurrence: recurrenceToSubdoc(params.recurrence ?? null),
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

  public async claimDueReminder(now: Date): Promise<ClaimedReminder | null> {
    // One reminder per fire time: due again only once next_fire_at moves
    // past the last send (delay, edit, recurrence rollover). A null
    // last_sent_at compares lower than any date, so never-sent tasks match.
    // findOneAndUpdate is atomic, so a second run (or replica) can't claim
    // the same task; we get the pre-claim document back to allow a release.
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
      scheduled_at: { $lte: beforeDate },
      recurrence: { $ne: null },
    });
    return docs.map((doc) => this.documentToEntity(doc));
  }

  public async update(params: UpdateTaskParams): Promise<Task> {
    try {
      const updateData: Record<string, unknown> = {};
      if (params.description !== undefined)
        updateData['description'] = params.description;
      if (params.scheduledAt !== undefined)
        updateData['scheduled_at'] = params.scheduledAt;
      if (params.timezone !== undefined)
        updateData['timezone'] = params.timezone;
      if (params.snoozedUntil !== undefined)
        updateData['snoozed_until'] = params.snoozedUntil;
      if (params.nextAttemptAt !== undefined)
        updateData['next_attempt_at'] = params.nextAttemptAt;
      if (params.status !== undefined) updateData['status'] = params.status;
      if (params.lastSentAt !== undefined)
        updateData['last_sent_at'] = params.lastSentAt;
      if (params.recurrence !== undefined)
        updateData['recurrence'] = recurrenceToSubdoc(params.recurrence);

      // next_fire_at is derived; recompute whenever either input changes.
      if (
        params.scheduledAt !== undefined ||
        params.snoozedUntil !== undefined
      ) {
        const existing = await this.model.findById(params.id);
        if (!existing) {
          throw new TaskNotFoundError(`Task with id ${params.id} not found`);
        }
        const scheduledAt = params.scheduledAt ?? existing.scheduled_at;
        const snoozedUntil =
          params.snoozedUntil !== undefined
            ? params.snoozedUntil
            : (existing.snoozed_until ?? null);
        updateData['next_fire_at'] = snoozedUntil ?? scheduledAt;
      }

      const doc = await this.model.findByIdAndUpdate(
        params.id,
        { $set: updateData },
        { new: true },
      );

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
    const snoozedUntil = document.snoozed_until ?? null;
    return {
      id: document._id.toHexString(),
      userId: document.user_id,
      telegramChatId: document.telegram_chat_id,
      description: document.description,
      scheduledAt: document.scheduled_at,
      timezone: document.timezone ?? LEGACY_TIMEZONE_FALLBACK,
      snoozedUntil,
      nextFireAt:
        document.next_fire_at ?? snoozedUntil ?? document.scheduled_at,
      nextAttemptAt: document.next_attempt_at ?? null,
      status: document.status as TaskStatus,
      recurrence: subdocToRecurrence(document.recurrence),
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
