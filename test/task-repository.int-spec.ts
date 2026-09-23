/**
 * Runs TaskRepositoryImpl against a real (in-memory) MongoDB. These are the
 * queries unit tests can't prove: the atomic claim with $expr, derived
 * next_fire_at, the view filters and the legacy backfill.
 *
 *   npm run test:int     (first run downloads a MongoDB binary)
 */
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TaskSchema } from '@infra/mongodb/task/schema';
import type { TaskDocument } from '@infra/mongodb/task/document';
import { TaskRepositoryImpl } from '@infra/mongodb/task/repository';
import { TaskStatus, type CreateTaskParams } from '@domain/task';

describe('TaskRepositoryImpl (real MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let model: Model<TaskDocument>;
  let repo: TaskRepositoryImpl;

  const now = new Date('2026-04-16T12:00:00Z');
  const past = new Date('2026-04-16T10:00:00Z');
  const future = new Date('2026-04-16T15:00:00Z');

  const params = (over: Partial<CreateTaskParams> = {}): CreateTaskParams => ({
    userId: 'user-1',
    telegramChatId: 42,
    description: 'Task',
    scheduledAt: past,
    timezone: 'Asia/Tashkent',
    source: {
      type: 'text',
      originalText: 'x',
      messageId: 7,
      forwardedFrom: null,
    },
    ...over,
  });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    model = mongoose.model<TaskDocument>('Task', TaskSchema);
    await model.syncIndexes();
    repo = new TaskRepositoryImpl(model);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('round-trips every v2 field', async () => {
    const created = await repo.create(
      params({
        notes: 'n',
        priority: 'high',
        categoryId: 'a'.repeat(24),
        leadMinutes: 30,
        recurrence: { type: 'monthly', anchorAt: past },
      }),
    );
    const found = await repo.findById(created.id);
    expect(found).toMatchObject({
      kind: 'reminder',
      notes: 'n',
      priority: 'high',
      categoryId: 'a'.repeat(24),
      leadMinutes: 30,
      timezone: 'Asia/Tashkent',
      scheduledAt: past,
      // leadMinutes 30 → the scheduler fires the heads-up first.
      nextFireAt: new Date('2026-04-16T09:30:00Z'),
      snoozedUntil: null,
      recurrence: { type: 'monthly', anchorAt: past },
      source: {
        type: 'text',
        originalText: 'x',
        messageId: 7,
        forwardedFrom: null,
      },
      completedAt: null,
      completions: [],
    });
  });

  describe('claimDueReminder', () => {
    it('claims a due task exactly once, oldest first, and skips future ones and todos', async () => {
      const older = await repo.create(
        params({ scheduledAt: new Date('2026-04-16T09:00:00Z') }),
      );
      const newer = await repo.create(params({ scheduledAt: past }));
      await repo.create(params({ scheduledAt: future }));
      await repo.create(params({ scheduledAt: null }));

      const first = await repo.claimDueReminder(now);
      const second = await repo.claimDueReminder(now);
      const third = await repo.claimDueReminder(now);

      expect(first?.task.id).toBe(older.id);
      expect(first?.previousLastSentAt).toBeUndefined();
      expect(first?.task.lastSentAt).toEqual(now);
      expect(second?.task.id).toBe(newer.id);
      expect(third).toBeNull();
    });

    it('never hands the same task to two concurrent claimers', async () => {
      await repo.create(params());
      const results = await Promise.all(
        Array.from({ length: 8 }, () => repo.claimDueReminder(now)),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('a snooze re-arms the reminder at the snoozed time, not before', async () => {
      const task = await repo.create(
        params({ recurrence: { type: 'daily', anchorAt: past } }),
      );
      await repo.claimDueReminder(now); // reminded for `past`
      const snoozedUntil = new Date('2026-04-16T13:00:00Z');
      const updated = await repo.update({ id: task.id, snoozedUntil });
      expect(updated.scheduledAt).toEqual(past); // series untouched
      expect(updated.nextFireAt).toEqual(snoozedUntil);

      expect(await repo.claimDueReminder(now)).toBeNull();
      const later = await repo.claimDueReminder(
        new Date('2026-04-16T13:00:30Z'),
      );
      expect(later?.task.id).toBe(task.id);
      expect(later?.previousLastSentAt).toEqual(now);
    });

    it('a fired task with a heads-up that is pushed a little later still fires again', async () => {
      // Due 10:00 with a 30 min lead; heads-up and reminder both went out.
      const task = await repo.create(params({ leadMinutes: 30 }));
      await repo.update({ id: task.id, leadSentFor: past });
      await repo.claimDueReminder(now);

      // "+15m": the new heads-up slot (12:00) is not after the last send.
      const moved = new Date('2026-04-16T12:30:00Z');
      const updated = await repo.update({ id: task.id, scheduledAt: moved });
      expect(updated.nextFireAt).toEqual(moved);

      const again = await repo.claimDueReminder(
        new Date('2026-04-16T12:30:30Z'),
      );
      expect(again?.task.id).toBe(task.id);
    });

    it('release restores the stamp and holds the task until nextAttemptAt', async () => {
      const task = await repo.create(params());
      const claim = await repo.claimDueReminder(now);
      const retryAt = new Date('2026-04-16T12:02:00Z');
      await repo.releaseReminderClaim(
        task.id,
        claim?.previousLastSentAt,
        retryAt,
      );

      expect(
        await repo.claimDueReminder(new Date('2026-04-16T12:01:00Z')),
      ).toBeNull();
      const retried = await repo.claimDueReminder(retryAt);
      expect(retried?.task.id).toBe(task.id);
    });

    it('ignores completed and deleted tasks', async () => {
      const a = await repo.create(params());
      const b = await repo.create(params());
      await repo.update({
        id: a.id,
        status: TaskStatus.Completed,
        completedAt: now,
      });
      await repo.update({ id: b.id, status: TaskStatus.Deleted });
      expect(await repo.claimDueReminder(now)).toBeNull();
    });
  });

  describe('update', () => {
    it('derives nextFireAt, and a todo never fires even with a stale snooze', async () => {
      const task = await repo.create(params({ scheduledAt: future }));
      const moved = await repo.update({
        id: task.id,
        scheduledAt: past,
        snoozedUntil: null,
      });
      expect(moved.nextFireAt).toEqual(past);

      const todo = await repo.update({ id: task.id, scheduledAt: null });
      expect(todo).toMatchObject({
        kind: 'todo',
        scheduledAt: null,
        nextFireAt: null,
      });
      expect(await repo.claimDueReminder(now)).toBeNull();
    });

    it('pushCompletion appends to the history', async () => {
      const task = await repo.create(
        params({ recurrence: { type: 'daily', anchorAt: past } }),
      );
      await repo.update({
        id: task.id,
        pushCompletion: { at: now, occurrenceAt: past },
      });
      const after = await repo.update({
        id: task.id,
        pushCompletion: { at: future, occurrenceAt: now },
      });
      expect(after.completions).toEqual([
        { at: now, occurrenceAt: past },
        { at: future, occurrenceAt: now },
      ]);
    });
  });

  describe('find (views)', () => {
    it('filters by kind, fire window, completion window, sort and limit, scoped to the user', async () => {
      const due = await repo.create(
        params({ description: 'due', scheduledAt: past }),
      );
      const later = await repo.create(
        params({ description: 'later', scheduledAt: future }),
      );
      const todo = await repo.create(
        params({ description: 'todo', scheduledAt: null }),
      );
      const doneOld = await repo.create(params({ description: 'done-old' }));
      const doneNew = await repo.create(params({ description: 'done-new' }));
      await repo.create(
        params({ userId: 'someone-else', description: 'foreign' }),
      );
      await repo.update({
        id: doneOld.id,
        status: TaskStatus.Completed,
        completedAt: new Date('2026-04-10T00:00:00Z'),
      });
      await repo.update({
        id: doneNew.id,
        status: TaskStatus.Completed,
        completedAt: now,
      });

      const names = async (f: Parameters<typeof repo.find>[0]) =>
        (await repo.find(f)).map((t) => t.description);
      const pending = [TaskStatus.Pending];

      expect(
        await names({
          userId: 'user-1',
          statuses: pending,
          kind: 'reminder',
          dueAtOrBefore: now,
          sort: 'dueAt',
        }),
      ).toEqual(['due']);
      expect(
        await names({
          userId: 'user-1',
          statuses: pending,
          kind: 'reminder',
          dueAfter: now,
          sort: 'dueAt',
        }),
      ).toEqual(['later']);
      expect(
        await names({
          userId: 'user-1',
          statuses: pending,
          kind: 'todo',
          sort: 'createdAtDesc',
        }),
      ).toEqual(['todo']);
      expect(
        await names({
          userId: 'user-1',
          statuses: [TaskStatus.Completed],
          sort: 'completedAtDesc',
        }),
      ).toEqual(['done-new', 'done-old']);
      expect(
        await names({
          userId: 'user-1',
          statuses: [TaskStatus.Completed],
          sort: 'completedAtDesc',
          limit: 1,
        }),
      ).toEqual(['done-new']);
      expect(
        await names({
          userId: 'user-1',
          statuses: [TaskStatus.Completed],
          completedAtOrAfter: new Date('2026-04-16T00:00:00Z'),
          sort: 'completedAtDesc',
        }),
      ).toEqual(['done-new']);
      expect([due.id, later.id, todo.id]).toHaveLength(3);
    });

    it("clearCategory uncategorises only that user's tasks with that category", async () => {
      const cat = 'c'.repeat(24);
      const mine = await repo.create(params({ categoryId: cat }));
      const other = await repo.create(params({ categoryId: 'd'.repeat(24) }));
      await repo.clearCategory('user-1', cat);
      expect((await repo.findById(mine.id))?.categoryId).toBeNull();
      expect((await repo.findById(other.id))?.categoryId).toBe('d'.repeat(24));
    });
  });

  it('backfills legacy documents at boot and reads them with sane defaults', async () => {
    const legacy = await model.collection.insertOne({
      user_id: 'user-1',
      telegram_chat_id: 42,
      description: 'Old task',
      scheduled_at: past,
      status: 'pending',
      created_at: past,
      updated_at: past,
    });
    const legacyDone = await model.collection.insertOne({
      user_id: 'user-1',
      telegram_chat_id: 42,
      description: 'Old done',
      scheduled_at: past,
      status: 'completed',
      created_at: past,
      updated_at: future,
    });

    await repo.onModuleInit();

    const task = await repo.findById(legacy.insertedId.toHexString());
    expect(task).toMatchObject({
      nextFireAt: past,
      timezone: 'UTC', // no OWNER_TIMEZONE in the test env
      priority: 'normal',
      kind: 'reminder',
      notes: null,
      source: { type: 'text', originalText: null },
      completions: [],
    });
    const done = await repo.findById(legacyDone.insertedId.toHexString());
    expect(done?.completedAt).toEqual(future);
    // …and the scheduler can now see the legacy task.
    expect((await repo.claimDueReminder(now))?.task.id).toBe(
      legacy.insertedId.toHexString(),
    );
  });
});
