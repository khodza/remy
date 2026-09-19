import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import type {
  ConversationRepository,
  ConversationState,
  MessageLink,
  NewUndoRecord,
  PendingForward,
  PendingQuestion,
  TaskSnapshot,
  UndoRecord,
} from '@domain/conversation';
import { Collections } from '../collections';

type BotMessageDoc = {
  chat_id: number;
  message_id: number;
  task_ids: string[];
  kind: string;
};
type ConversationDoc = {
  chat_id: number;
  pending_question: PendingQuestion | null;
  pending_forward: PendingForward | null;
  last_task_ids: string[];
};
type UndoDoc = {
  _id: Types.ObjectId;
  chat_id: number;
  user_id: string;
  label: string;
  snapshots: TaskSnapshot[];
  created_task_ids: string[];
  expires_at: Date;
  used_at: Date | null;
};

@Injectable()
export class ConversationRepositoryImpl implements ConversationRepository {
  constructor(
    @InjectModel(Collections.BotMessages)
    private readonly messages: Model<BotMessageDoc>,
    @InjectModel(Collections.Conversations)
    private readonly conversations: Model<ConversationDoc>,
    @InjectModel(Collections.UndoRecords)
    private readonly undos: Model<UndoDoc>,
  ) {}

  public async linkMessage(link: MessageLink): Promise<void> {
    if (link.taskIds.length === 0) return;
    await this.messages.updateOne(
      { chat_id: link.chatId, message_id: link.messageId },
      { $set: { task_ids: link.taskIds, kind: link.kind } },
      { upsert: true },
    );
  }

  public async findLinkedTaskIds(
    chatId: number,
    messageId: number,
  ): Promise<string[]> {
    const doc = await this.messages
      .findOne({ chat_id: chatId, message_id: messageId })
      .lean();
    return doc?.task_ids ?? [];
  }

  public async getState(chatId: number): Promise<ConversationState> {
    const doc = await this.conversations.findOne({ chat_id: chatId }).lean();
    return {
      chatId,
      pendingQuestion: reviveDates(doc?.pending_question ?? null, ['askedAt']),
      pendingForward: reviveDates(doc?.pending_forward ?? null, ['receivedAt']),
      lastTaskIds: doc?.last_task_ids ?? [],
    };
  }

  public async setPendingQuestion(
    chatId: number,
    question: PendingQuestion | null,
  ): Promise<void> {
    await this.patch(chatId, { pending_question: question });
  }

  public async setPendingForward(
    chatId: number,
    forward: PendingForward | null,
  ): Promise<void> {
    await this.patch(chatId, { pending_forward: forward });
  }

  public async setLastTaskIds(
    chatId: number,
    taskIds: string[],
  ): Promise<void> {
    await this.patch(chatId, { last_task_ids: taskIds.slice(0, 20) });
  }

  public async saveUndo(record: NewUndoRecord): Promise<string> {
    const doc = await this.undos.create({
      chat_id: record.chatId,
      user_id: record.userId,
      label: record.label,
      snapshots: record.snapshots,
      created_task_ids: record.createdTaskIds,
      expires_at: record.expiresAt,
      used_at: null,
    });
    return doc._id.toHexString();
  }

  public async takeUndo(
    id: string,
    chatId: number,
    now: Date,
  ): Promise<UndoRecord | null> {
    if (!isValidObjectId(id)) return null;
    // Atomic: two taps on the same Undo button can't both apply it.
    const doc = await this.undos
      .findOneAndUpdate(
        { _id: id, chat_id: chatId, used_at: null, expires_at: { $gt: now } },
        { $set: { used_at: now } },
        { new: false },
      )
      .lean();
    if (!doc) return null;
    return {
      id: doc._id.toHexString(),
      chatId: doc.chat_id,
      userId: doc.user_id,
      label: doc.label,
      snapshots: doc.snapshots.map((s) => ({
        ...s,
        recurrence: s.recurrence ?? null,
      })),
      createdTaskIds: doc.created_task_ids,
      expiresAt: doc.expires_at,
    };
  }

  private async patch(
    chatId: number,
    set: Partial<ConversationDoc>,
  ): Promise<void> {
    await this.conversations.updateOne(
      { chat_id: chatId },
      { $set: set, $setOnInsert: { chat_id: chatId } },
      { upsert: true },
    );
  }
}

/** Mixed fields come back as plain JSON-ish objects; make sure dates are Dates. */
function reviveDates<T extends object>(
  value: T | null,
  keys: (keyof T)[],
): T | null {
  if (!value) return null;
  const copy = { ...value };
  for (const key of keys) {
    const raw = copy[key] as unknown;
    if (raw !== undefined && raw !== null && !(raw instanceof Date)) {
      (copy[key] as unknown) = new Date(raw as string);
    }
  }
  return copy;
}
