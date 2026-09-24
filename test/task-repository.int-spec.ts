/**
 * Runs TaskRepositoryImpl against a real (in-memory) MongoDB. These are the
 * queries unit tests can't prove: the atomic claim with $expr, derived
 * next_fire_at, the view filters and the legacy backfill.
 *
 *   npm run test:int     (first run downloads a MongoDB binary)
 */
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  DELETED_TASK_TTL_SECONDS,
  TaskSchema,
} from '@infra/mongodb/task/schema';
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
        recurrence: { type: 'monthly', count: 12, anchorAt: past },
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
      recurrence: { type: 'monthly', count: 12, anchorAt: past },
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

    it('counts retries, gives up after the cap, and a new time starts over', async () => {
      const task = await repo.create(params());
      const claim = await repo.claimDueReminder(now);
      await repo.releaseReminderClaim(
        task.id,
        claim?.previousLastSentAt,
        new Date('2026-04-16T12:02:00Z'),
        { countAttempt: true },
      );
      expect((await repo.findById(task.id))?.reminderAttempts).toBe(1);

      // The last attempt fails: the claim is kept and the task is flagged.
      const retryAt = new Date('2026-04-16T12:02:00Z');
      expect((await repo.claimDueReminder(retryAt))?.task.id).toBe(task.id);
      await repo.markDeliveryFailed(task.id, retryAt);
      const failed = await repo.findById(task.id);
      expect(failed).toMatchObject({
        reminderAttempts: 2,
        deliveryFailedAt: retryAt,
        nextAttemptAt: null,
      });
      expect(
        await repo.claimDueReminder(new Date('2026-04-16T13:00:00Z')),
      ).toBeNull();
      expect(
        (
          await repo.find({
            userId: 'user-1',
            statuses: [TaskStatus.Pending],
            deliveryFailed: true,
            sort: 'dueAt',
          })
        ).map((t) => t.id),
      ).toEqual([task.id]);

      // A new time is a fresh delivery: claimable again, counters cleared.
      await repo.update({ id: task.id, scheduledAt: future });
      expect(await repo.findById(task.id)).toMatchObject({
        reminderAttempts: 0,
        deliveryFailedAt: null,
      });
      expect((await repo.claimDueReminder(future))?.task.id).toBe(task.id);
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

  describe('findOverdueRecurring (rollover scan, B10)', () => {
    it('returns only repeating tasks whose next cycle has arrived', async () => {
      // Daily at 10:00Z: reminded and ignored, but tomorrow's cycle is not
      // here yet, so there is nothing to roll and it must not be scanned.
      await repo.create(
        params({ scheduledAt: past, recurrence: { type: 'daily' } }),
      );
      // Two cycles behind: the next cycle (yesterday) has passed.
      const behind = await repo.create(
        params({
          scheduledAt: new Date('2026-04-14T10:00:00Z'),
          recurrence: { type: 'daily' },
        }),
      );
      // One-off in the past: never rolled.
      await repo.create(params({ scheduledAt: past }));
      // Last occurrence of a finished series: nothing after it.
      await repo.create(
        params({
          scheduledAt: new Date('2026-04-14T10:00:00Z'),
          recurrence: {
            type: 'daily',
            count: 1,
            anchorAt: new Date('2026-04-14T10:00:00Z'),
          },
        }),
      );

      const found = await repo.findOverdueRecurring(now);
      expect(found.map((t) => t.id)).toEqual([behind.id]);

      // Rolling it forward moves the scan time with it.
      await repo.update({ id: behind.id, scheduledAt: past });
      expect(await repo.findOverdueRecurring(now)).toEqual([]);
      expect((await model.findById(behind.id))?.rollover_at).toEqual(
        new Date('2026-04-17T10:00:00Z'),
      );
    });

    it('a recurrence added or removed later updates the scan time', async () => {
      const task = await repo.create(
        params({ scheduledAt: new Date('2026-04-14T10:00:00Z') }),
      );
      expect((await model.findById(task.id))?.rollover_at).toBeNull();
      await repo.update({ id: task.id, recurrence: { type: 'daily' } });
      expect((await repo.findOverdueRecurring(now)).map((t) => t.id)).toEqual([
        task.id,
      ]);
      await repo.update({ id: task.id, recurrence: null });
      expect(await repo.findOverdueRecurring(now)).toEqual([]);
    });

    it('is backfilled at boot for repeating tasks that predate it', async () => {
      const legacy = await model.collection.insertOne({
        user_id: 'user-1',
        telegram_chat_id: 42,
        description: 'Old daily',
        scheduled_at: new Date('2026-04-14T10:00:00Z'),
        timezone: 'UTC',
        recurrence: { type: 'daily' },
        status: 'pending',
        created_at: past,
        updated_at: past,
      });
      expect(await repo.findOverdueRecurring(now)).toEqual([]);
      await repo.onModuleInit();
      expect((await repo.findOverdueRecurring(now)).map((t) => t.id)).toEqual([
        legacy.insertedId.toHexString(),
      ]);
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

  it('backfills the 2.4.0 fields idempotently: all_day, list, deleted_at', async () => {
    const legacyDeleted = await model.collection.insertOne({
      user_id: 'user-1',
      telegram_chat_id: 42,
      description: 'Old deleted',
      scheduled_at: past,
      status: 'deleted',
      created_at: past,
      updated_at: past,
    });
    const legacyOpen = await model.collection.insertOne({
      user_id: 'user-1',
      telegram_chat_id: 42,
      description: 'Old open',
      scheduled_at: null,
      status: 'pending',
      created_at: past,
      updated_at: past,
    });

    await repo.onModuleInit();
    await repo.onModuleInit(); // a second boot changes nothing

    const raw = (id: unknown) => model.collection.findOne({ _id: id as never });
    expect(await raw(legacyDeleted.insertedId)).toMatchObject({
      all_day: false,
      list: null,
      deleted_at: past, // its purge clock starts at its last change
    });
    const open = await raw(legacyOpen.insertedId);
    expect(open).toMatchObject({ all_day: false, list: null });
    expect(open?.['deleted_at'] ?? null).toBeNull(); // never purged
    expect(
      await repo.findById(legacyOpen.insertedId.toHexString()),
    ).toMatchObject({ allDay: false, list: null, kind: 'todo' });
  });

  describe('2.4.0 fields', () => {
    it('round-trips allDay and list; a todo is never all-day', async () => {
      const allDay = await repo.create(
        params({ allDay: true, list: 'shopping' }),
      );
      expect(await repo.findById(allDay.id)).toMatchObject({
        allDay: true,
        list: 'shopping',
      });
      const todo = await repo.create(
        params({ scheduledAt: null, allDay: true }),
      );
      expect((await repo.findById(todo.id))?.allDay).toBe(false);
      const moved = await repo.update({
        id: allDay.id,
        allDay: false,
        list: null,
      });
      expect(moved).toMatchObject({ allDay: false, list: null });
    });

    it('soft delete starts the 30-day purge clock and a restore (Undo) stops it', async () => {
      const task = await repo.create(params());
      await repo.update({ id: task.id, status: TaskStatus.Deleted });
      const byId = await model.findById(task.id).lean();
      expect(byId?.deleted_at).toBeInstanceOf(Date);
      await repo.update({ id: task.id, status: TaskStatus.Pending });
      expect((await model.findById(task.id).lean())?.deleted_at).toBeNull();

      const indexes = await model.collection.indexes();
      const ttl = indexes.find((i) => i.key['deleted_at'] === 1);
      expect(ttl?.expireAfterSeconds).toBe(DELETED_TASK_TTL_SECONDS);
      expect(DELETED_TASK_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    });

    it('filters by list and searches title, notes and list, every word, case-insensitive', async () => {
      const milk = await repo.create(
        params({ description: 'Buy MILK', list: 'shopping' }),
      );
      const bread = await repo.create(
        params({
          description: 'Bread',
          notes: 'the (whole) grain one',
          list: 'shopping',
        }),
      );
      const call = await repo.create(params({ description: 'Call mom' }));
      await repo.create(params({ userId: 'user-2', description: 'Buy milk' }));
      const deleted = await repo.create(
        params({ description: 'Buy milk too' }),
      );
      await repo.update({ id: deleted.id, status: TaskStatus.Deleted });
      const base = {
        userId: 'user-1',
        statuses: [TaskStatus.Pending, TaskStatus.Completed],
        sort: 'createdAtDesc' as const,
      };
      const ids = async (extra: object) =>
        (await repo.find({ ...base, ...extra })).map((t) => t.id).sort();

      expect(await ids({ list: 'shopping' })).toEqual(
        [milk.id, bread.id].sort(),
      );
      expect(await ids({ search: ['milk'] })).toEqual([milk.id]);
      expect(await ids({ search: ['buy', 'milk'] })).toEqual([milk.id]);
      expect(await ids({ search: ['(whole)'] })).toEqual([bread.id]);
      expect(await ids({ search: ['shop'] })).toEqual(
        [milk.id, bread.id].sort(),
      );
      expect(await ids({ search: ['mom'], list: 'shopping' })).toEqual([]);
      expect(await ids({ search: ['.*'] })).toEqual([]);
      expect(call.id).toBeDefined();
    });

    it('summarises lists (pending / completed, deleted ignored) and deletes all of a user', async () => {
      await repo.create(params({ list: 'shopping' }));
      const done = await repo.create(params({ list: 'shopping' }));
      await repo.update({ id: done.id, status: TaskStatus.Completed });
      const gone = await repo.create(params({ list: 'ideas' }));
      await repo.update({ id: gone.id, status: TaskStatus.Deleted });
      await repo.create(params({ list: 'books' }));
      await repo.create(params({ userId: 'user-2', list: 'secret' }));

      expect(await repo.listSummaries('user-1')).toEqual([
        { name: 'books', pending: 1, completed: 0 },
        { name: 'shopping', pending: 1, completed: 1 },
      ]);

      expect(await repo.deleteAllForUser('user-1')).toBe(4);
      expect(await model.countDocuments({})).toBe(1);
    });
  });
});
