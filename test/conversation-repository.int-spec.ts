/** ConversationRepositoryImpl and the Phase 3 task fields against a real (in-memory) MongoDB. */
import mongoose, { type Model } from 'mongoose';
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
import { TaskStatus } from '@domain/task';

describe('Phase 3 persistence (real MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let conversations: ConversationRepositoryImpl;
  let tasks: TaskRepositoryImpl;
  let taskModel: Model<TaskDocument>;
  const now = new Date('2026-09-18T10:00:00Z');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const messages = mongoose.model('BotMessage', BotMessageSchema);
    const convs = mongoose.model('Conversation', ConversationSchema);
    const undos = mongoose.model('UndoRecord', UndoRecordSchema);
    taskModel = mongoose.model<TaskDocument>('TaskP3', TaskSchema);
    await Promise.all([
      messages.syncIndexes(),
      convs.syncIndexes(),
      undos.syncIndexes(),
    ]);
    conversations = new ConversationRepositoryImpl(
      messages as never,
      convs as never,
      undos as never,
    );
    tasks = new TaskRepositoryImpl(taskModel);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('links a bot message to tasks and re-links idempotently', async () => {
    await conversations.linkMessage({
      chatId: 42,
      messageId: 900,
      taskIds: ['a', 'b'],
      kind: 'agenda',
    });
    await conversations.linkMessage({
      chatId: 42,
      messageId: 900,
      taskIds: ['c'],
      kind: 'confirmation',
    });
    expect(await conversations.findLinkedTaskIds(42, 900)).toEqual(['c']);
    expect(await conversations.findLinkedTaskIds(42, 901)).toEqual([]);
    expect(await conversations.findLinkedTaskIds(7, 900)).toEqual([]);
  });

  it('keeps per-chat state with real Dates', async () => {
    expect(await conversations.getState(1)).toEqual({
      chatId: 1,
      pendingQuestion: null,
      pendingForward: null,
      lastTaskIds: [],
    });
    await conversations.setPendingQuestion(1, {
      originalText: 'call mom at 5',
      question: 'AM or PM?',
      options: ['05:00', '17:00'],
      askedAt: now,
    });
    await conversations.setPendingForward(1, {
      text: 'hello',
      forwardedFrom: 'Clinic',
      messageId: 5,
      receivedAt: now,
    });
    await conversations.setLastTaskIds(1, ['x', 'y']);

    const state = await conversations.getState(1);
    expect(state.pendingQuestion).toEqual({
      originalText: 'call mom at 5',
      question: 'AM or PM?',
      options: ['05:00', '17:00'],
      askedAt: now,
    });
    expect(state.pendingQuestion?.askedAt).toBeInstanceOf(Date);
    expect(state.pendingForward?.receivedAt).toBeInstanceOf(Date);
    expect(state.lastTaskIds).toEqual(['x', 'y']);

    await conversations.setPendingQuestion(1, null);
    expect((await conversations.getState(1)).pendingQuestion).toBeNull();
  });

  it('an undo record can be taken exactly once, even by concurrent taps', async () => {
    const id = await conversations.saveUndo({
      chatId: 42,
      userId: 'user-1',
      label: 'completed "Gym"',
      snapshots: [
        {
          taskId: 't',
          status: TaskStatus.Pending,
          description: 'Gym',
          notes: null,
          scheduledAt: now,
          snoozedUntil: null,
          completedAt: null,
          recurrence: { type: 'daily', anchorAt: now },
          completionsCount: 2,
        },
      ],
      createdTaskIds: [],
      expiresAt: new Date('2026-09-18T10:10:00Z'),
    });

    expect(await conversations.takeUndo(id, 7, now)).toBeNull(); // wrong chat
    const results = await Promise.all(
      Array.from({ length: 6 }, () => conversations.takeUndo(id, 42, now)),
    );
    const taken = results.filter((r) => r !== null);
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({
      label: 'completed "Gym"',
      snapshots: [{ taskId: 't', scheduledAt: now, completionsCount: 2 }],
    });
    expect(taken[0]?.snapshots[0]?.scheduledAt).toBeInstanceOf(Date);

    const expired = await conversations.saveUndo({
      chatId: 42,
      userId: 'u',
      label: 'x',
      snapshots: [],
      createdTaskIds: ['a'],
      expiresAt: new Date('2026-09-18T09:59:00Z'),
    });
    expect(await conversations.takeUndo(expired, 42, now)).toBeNull();
    expect(await conversations.takeUndo('not-an-id', 42, now)).toBeNull();
  });

  describe('tasks', () => {
    const base = {
      userId: 'user-1',
      telegramChatId: 42,
      description: 'Flight',
      timezone: 'Asia/Tashkent',
      source: {
        type: 'text' as const,
        originalText: null,
        messageId: null,
        forwardedFrom: null,
      },
    };

    it('"remind me before": the heads-up fires first, then the due reminder, once each', async () => {
      const dueAt = new Date('2026-09-18T13:00:00Z');
      const task = await tasks.create({
        ...base,
        scheduledAt: dueAt,
        leadMinutes: 180,
      });
      expect(task.nextFireAt).toEqual(new Date('2026-09-18T10:00:00Z'));

      const headsUp = await tasks.claimDueReminder(now);
      expect(headsUp?.task.id).toBe(task.id);
      const afterHeadsUp = await tasks.update({
        id: task.id,
        leadSentFor: dueAt,
      });
      expect(afterHeadsUp.nextFireAt).toEqual(dueAt);

      expect(
        await tasks.claimDueReminder(new Date('2026-09-18T12:59:00Z')),
      ).toBeNull();
      expect((await tasks.claimDueReminder(dueAt))?.task.id).toBe(task.id);
      expect(
        await tasks.claimDueReminder(new Date('2026-09-18T13:05:00Z')),
      ).toBeNull();
    });

    it('round-trips the richer recurrence and truncates completions for undo', async () => {
      const at = new Date('2026-09-21T02:00:00Z');
      const until = new Date('2026-12-31T18:59:59Z');
      const task = await tasks.create({
        ...base,
        description: 'Gym',
        scheduledAt: at,
        recurrence: {
          type: 'weekly',
          interval: 2,
          byWeekday: [1, 4],
          until,
          anchorAt: at,
        },
      });
      expect((await tasks.findById(task.id))?.recurrence).toEqual({
        type: 'weekly',
        interval: 2,
        byWeekday: [1, 4],
        until,
        anchorAt: at,
      });

      // A plain recurrence must not grow an empty byWeekday array.
      const plain = await tasks.create({
        ...base,
        scheduledAt: at,
        recurrence: { type: 'daily', anchorAt: at },
      });
      expect((await tasks.findById(plain.id))?.recurrence).toEqual({
        type: 'daily',
        anchorAt: at,
      });

      await tasks.update({
        id: task.id,
        pushCompletion: { at: now, occurrenceAt: at },
      });
      await tasks.update({
        id: task.id,
        pushCompletion: { at: now, occurrenceAt: at },
      });
      const undone = await tasks.update({
        id: task.id,
        truncateCompletions: 1,
      });
      expect(undone.completions).toHaveLength(1);
    });
  });
});
