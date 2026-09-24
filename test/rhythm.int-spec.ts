/** Phase 4 persistence against a real (in-memory) MongoDB. */
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TaskSchema } from '@infra/mongodb/task/schema';
import type { TaskDocument } from '@infra/mongodb/task/document';
import { TaskRepositoryImpl } from '@infra/mongodb/task/repository';
import { UserSchema } from '@infra/mongodb/user/schema';
import { UserRepositoryImpl } from '@infra/mongodb/user/repository';
import {
  BotMessageSchema,
  ConversationRepositoryImpl,
  ConversationSchema,
  UndoRecordSchema,
} from '@infra/mongodb/conversation';
import { TaskStatus } from '@domain/task';

describe('Phase 4 persistence (real MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let taskModel: Model<TaskDocument>;
  let tasks: TaskRepositoryImpl;
  let users: UserRepositoryImpl;
  let conversations: ConversationRepositoryImpl;

  const base = {
    userId: 'user-1',
    telegramChatId: 42,
    description: 'Task',
    timezone: 'Asia/Tashkent',
    source: {
      type: 'text' as const,
      originalText: null,
      messageId: null,
      forwardedFrom: null,
    },
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    taskModel = mongoose.model<TaskDocument>('TaskP4', TaskSchema);
    const userModel = mongoose.model('UserP4', UserSchema);
    const messages = mongoose.model('BotMessageP4', BotMessageSchema);
    const convs = mongoose.model('ConversationP4', ConversationSchema);
    const undos = mongoose.model('UndoRecordP4', UndoRecordSchema);
    await Promise.all([
      taskModel.syncIndexes(),
      userModel.syncIndexes(),
      messages.syncIndexes(),
    ]);
    tasks = new TaskRepositoryImpl(taskModel);
    users = new UserRepositoryImpl(userModel as never);
    conversations = new ConversationRepositoryImpl(
      messages as never,
      convs as never,
      undos as never,
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await taskModel.deleteMany({});
  });

  it('persists leadSentFor (it used to be derived but never stored)', async () => {
    const due = new Date('2026-09-18T13:00:00Z');
    const task = await tasks.create({
      ...base,
      scheduledAt: due,
      leadMinutes: 30,
    });
    await tasks.update({ id: task.id, leadSentFor: due });
    expect((await tasks.findById(task.id))?.leadSentFor).toEqual(due);
    // A later recalculation (lead changed) must still know the heads-up went out.
    const after = await tasks.update({ id: task.id, leadMinutes: 60 });
    expect(after.nextFireAt).toEqual(due);
  });

  it('nudges: fire time follows nudgeAt; a snooze resets them; snoozes are counted', async () => {
    const due = new Date('2026-09-18T10:00:00Z');
    const task = await tasks.create({ ...base, scheduledAt: due });
    const nudgeAt = new Date('2026-09-18T10:30:00Z');

    const nudged = await tasks.update({ id: task.id, nudgeAt, nudgeCount: 0 });
    expect(nudged.nextFireAt).toEqual(nudgeAt);
    expect(
      await tasks.claimDueReminder(new Date('2026-09-18T10:29:00Z')),
    ).toBeNull();
    expect((await tasks.claimDueReminder(nudgeAt))?.task.id).toBe(task.id);

    const until = new Date('2026-09-18T15:00:00Z');
    const snoozed = await tasks.update({
      id: task.id,
      snoozedUntil: until,
      incrementSnoozeCount: true,
    });
    expect(snoozed).toMatchObject({
      nudgeAt: null,
      nudgeCount: 0,
      nextFireAt: until,
      snoozeCount: 1,
    });
    await tasks.update({
      id: task.id,
      snoozedUntil: new Date('2026-09-18T16:00:00Z'),
      incrementSnoozeCount: true,
    });
    expect((await tasks.findById(task.id))?.snoozeCount).toBe(2);
  });

  it('views filter on the due time: a pending heads-up or nudge does not move a task between days', async () => {
    // Due 00:30 local on the 19th (19:30Z on the 18th) with a 60-min heads-up
    // at 23:30 local on the 18th.
    const dueTomorrow = new Date('2026-09-18T19:30:00Z');
    const early = await tasks.create({
      ...base,
      description: 'Early flight',
      scheduledAt: dueTomorrow,
      leadMinutes: 60,
    });
    expect(early.nextFireAt).toEqual(new Date('2026-09-18T18:30:00Z'));

    const endOfThe18th = new Date('2026-09-18T18:59:59.999Z'); // local end of day
    const today = await tasks.find({
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      dueAtOrBefore: endOfThe18th,
      sort: 'dueAt',
    });
    const upcoming = await tasks.find({
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      dueAfter: endOfThe18th,
      sort: 'dueAt',
    });
    expect(today.map((t) => t.description)).toEqual([]);
    expect(upcoming.map((t) => t.description)).toEqual(['Early flight']);
  });

  it('backfills due_at on old documents at boot', async () => {
    const at = new Date('2026-09-18T10:00:00Z');
    const snooze = new Date('2026-09-18T12:00:00Z');
    const inserted = await taskModel.collection.insertOne({
      user_id: 'user-1',
      telegram_chat_id: 42,
      description: 'Legacy',
      scheduled_at: at,
      snoozed_until: snooze,
      next_fire_at: snooze,
      timezone: 'UTC',
      status: 'pending',
      created_at: at,
      updated_at: at,
    });
    await tasks.onModuleInit();
    const found = await tasks.find({
      userId: 'user-1',
      statuses: [TaskStatus.Pending],
      dueAtOrBefore: snooze,
      dueAfter: at,
      sort: 'dueAt',
    });
    expect(found.map((t) => t.id)).toEqual([inserted.insertedId.toHexString()]);
  });

  it('updatedAtOrAfter selects recent activity', async () => {
    const t = await tasks.create({
      ...base,
      scheduledAt: new Date('2026-09-18T10:00:00Z'),
    });
    const later = new Date(Date.now() + 60_000);
    expect(
      await tasks.find({
        userId: 'user-1',
        statuses: [TaskStatus.Pending],
        updatedAtOrAfter: new Date(0),
        sort: 'dueAt',
      }),
    ).toHaveLength(1);
    expect(
      await tasks.find({
        userId: 'user-1',
        statuses: [TaskStatus.Pending],
        updatedAtOrAfter: later,
        sort: 'dueAt',
      }),
    ).toHaveLength(0);
    expect(t.id).toBeDefined();
  });

  it('a digest is claimed exactly once per user, kind and local date, even concurrently', async () => {
    const user = await users.save({ telegramUserId: 777, firstName: 'Owner' });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        users.claimDigest(user.id, 'brief', '2026-09-18'),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await users.claimDigest(user.id, 'review', '2026-09-18')).toBe(true); // other kind
    expect(await users.claimDigest(user.id, 'brief', '2026-09-19')).toBe(true); // next day
    expect((await users.listAll()).map((u) => u.id)).toContain(user.id);
    // Settings saved before weeklyWrap existed still read with the default.
    expect((await users.findById(user.id))?.settings.weeklyWrap).toEqual({
      enabled: true,
    });
  });

  it('evening review rows resolve first-wins and keep their dates', async () => {
    const dueAt = new Date('2026-09-18T06:00:00Z');
    await conversations.saveReview(42, 800, {
      timezone: 'Asia/Tashkent',
      doneToday: 2,
      items: [
        {
          taskId: 'a',
          title: 'Pay bill',
          dueAt,
          recurring: false,
          outcome: null,
          newDueAt: null,
        },
        {
          taskId: 'b',
          title: 'Gym',
          dueAt,
          recurring: true,
          outcome: null,
          newDueAt: null,
        },
      ],
    });
    // The review message is linked, so text replies to it work too.
    expect(await conversations.findLinkedTaskIds(42, 800)).toEqual(['a', 'b']);

    const tomorrow = new Date('2026-09-19T04:00:00Z');
    const results = await Promise.all([
      conversations.resolveReviewItem(42, 800, 'a', 'tomorrow', tomorrow),
      conversations.resolveReviewItem(42, 800, 'a', 'done', null),
      conversations.resolveReviewItem(42, 800, 'a', 'inbox', null),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);

    const stored = await conversations.getReview(42, 800);
    expect(stored?.doneToday).toBe(2);
    expect(stored?.items[0]?.outcome).not.toBeNull();
    expect(stored?.items[0]?.dueAt).toEqual(dueAt);
    expect(stored?.items[1]).toMatchObject({ outcome: null, newDueAt: null });
    expect(
      await conversations.resolveReviewItem(42, 800, 'nope', 'done', null),
    ).toBeNull();
    expect(await conversations.getReview(42, 999)).toBeNull();

    // Undo reopens exactly the named rows, buttons and all.
    await conversations.resolveReviewItem(42, 800, 'b', 'done', null);
    const reopened = await conversations.reopenReviewItems(42, 800, ['a']);
    expect(reopened?.items.map((i) => i.outcome)).toEqual([null, 'done']);
    expect(reopened?.items[0]).toMatchObject({ newDueAt: null, dueAt });
    expect(await conversations.reopenReviewItems(42, 999, ['a'])).toBeNull();
  });
});
