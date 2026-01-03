import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Injectable } from '@nestjs/common';
import {
  TaskRepository,
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus,
} from '@domain/task/repository';
import { TaskDocument, TaskHydratedDocument } from './document';
import { Collections } from '../collections';
import {
  TaskNotFoundError,
  FailedToCreateTaskError,
  FailedToUpdateTaskError,
} from '@domain/task/errors';
import { ApplicationError } from '@domain/error';

@Injectable()
export class TaskRepositoryImpl implements TaskRepository {
  constructor(
    @InjectModel(Collections.Tasks)
    private readonly model: Model<TaskHydratedDocument>,
  ) {}

  public async create(params: CreateTaskParams): Promise<Task> {
    try {
      const doc = await this.model.create({
        user_id: params.userId,
        telegram_chat_id: params.telegramChatId,
        description: params.description,
        scheduled_at: params.scheduledAt,
        status: TaskStatus.Pending,
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

  public async findPendingReminders(beforeDate: Date): Promise<Task[]> {
    // Find tasks that are:
    // 1. Pending status
    // 2. Scheduled before the given date
    // 3. Either never sent OR not sent in the last minute
    const oneMinuteAgo = new Date(Date.now() - 60000);

    const docs = await this.model.find({
      status: TaskStatus.Pending,
      scheduled_at: { $lte: beforeDate },
      $or: [
        { last_sent_at: { $exists: false } }, // Never sent
        { last_sent_at: { $lt: oneMinuteAgo } }, // Not sent recently
      ],
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
      if (params.status !== undefined) updateData['status'] = params.status;
      if (params.lastSentAt !== undefined)
        updateData['last_sent_at'] = params.lastSentAt;

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
    return {
      id: document._id.toHexString(),
      userId: document.user_id,
      telegramChatId: document.telegram_chat_id,
      description: document.description,
      scheduledAt: document.scheduled_at,
      status: document.status as TaskStatus,
      lastSentAt: document.last_sent_at,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    };
  }
}
