/** "Delete all my data" end to end over the real repositories and MongoDB. */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  BotMessageSchema,
  ConversationRepositoryImpl,
  ConversationSchema,
  UndoRecordSchema,
} from '@infra/mongodb/conversation';
import { TaskSchema } from '@infra/mongodb/task/schema';
import type { TaskDocument } from '@infra/mongodb/task/document';
import { TaskRepositoryImpl } from '@infra/mongodb/task/repository';
import { UserSchema } from '@infra/mongodb/user/schema';
import type { UserDocument } from '@infra/mongodb/user/document';
import { UserRepositoryImpl } from '@infra/mongodb/user/repository';
import { DEFAULT_USER_SETTINGS } from '@domain/user';
import { TaskStatus } from '@domain/task';
import { DeleteAllDataUsecase } from '@usecases/data/delete-all-data';

describe('DeleteAllDataUsecase (real MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let conn: mongoose.Connection;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    conn = await mongoose.createConnection(mongod.getUri()).asPromise();
  });

  afterAll(async () => {
    await conn.close();
    await mongod.stop();
  });

  it('wipes tasks, conversation memory, categories, the feed and settings; keeps the account and other users', async () => {
    const userModel = conn.model<UserDocument>('User', UserSchema);
    const taskModel = conn.model<TaskDocument>('Task', TaskSchema);
    const messages = conn.model('BotMessage', BotMessageSchema);
    const convs = conn.model('Conversation', ConversationSchema);
    const undos = conn.model('UndoRecord', UndoRecordSchema);
    const users = new UserRepositoryImpl(userModel as never);
    const tasks = new TaskRepositoryImpl(taskModel);
    const conversations = new ConversationRepositoryImpl(
      messages as never,
      convs as never,
      undos as never,
    );

    const owner = await users.save({
      telegramUserId: 42,
      firstName: 'Owner',
      timezone: 'Asia/Tashkent',
    });
    const other = await users.save({ telegramUserId: 7, firstName: 'Other' });
    await users.update({
      id: owner.id,
      calendarToken: 'x'.repeat(43),
      categories: [
        { id: 'c1', name: 'Work', emoji: '💼', color: '#000000', keywords: [] },
      ],
      settings: { ...DEFAULT_USER_SETTINGS, voiceBrief: true },
    });
    const source = {
      type: 'text' as const,
      originalText: null,
      messageId: null,
      forwardedFrom: null,
    };
    const base = {
      telegramChatId: 42,
      scheduledAt: null,
      timezone: 'UTC',
      source,
    };
    const t1 = await tasks.create({
      ...base,
      userId: owner.id,
      description: 'a',
    });
    const t2 = await tasks.create({
      ...base,
      userId: owner.id,
      description: 'b',
    });
    await tasks.update({ id: t2.id, status: TaskStatus.Deleted });
    await tasks.create({ ...base, userId: other.id, description: 'theirs' });
    await conversations.linkMessage({
      chatId: 42,
      messageId: 1,
      taskIds: [t1.id],
      kind: 'confirmation',
    });
    await conversations.linkMessage({
      chatId: 7,
      messageId: 1,
      taskIds: ['x'],
      kind: 'confirmation',
    });
    await conversations.setLastTaskIds(42, [t1.id]);
    await conversations.saveUndo({
      chatId: 42,
      userId: owner.id,
      label: 'x',
      snapshots: [],
      createdTaskIds: [],
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await new DeleteAllDataUsecase(
      users,
      tasks,
      conversations,
    ).execute({ userId: owner.id });

    expect(result).toEqual({ deletedTasks: 2 });
    expect(await taskModel.countDocuments({ user_id: owner.id })).toBe(0);
    expect(await taskModel.countDocuments({ user_id: other.id })).toBe(1);
    expect(await conversations.findLinkedTaskIds(42, 1)).toEqual([]);
    expect(await conversations.findLinkedTaskIds(7, 1)).toEqual(['x']);
    expect((await conversations.getState(42)).lastTaskIds).toEqual([]);
    expect(await undos.countDocuments({ chat_id: 42 })).toBe(0);
    const after = await users.findById(owner.id);
    expect(after).toMatchObject({
      telegramUserId: 42,
      timezone: 'Asia/Tashkent',
      calendarToken: null,
      categories: null,
      settings: DEFAULT_USER_SETTINGS,
    });
    expect(await users.findByCalendarToken('x'.repeat(43))).toBeNull();
  });
});
