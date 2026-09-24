import { SendPendingRemindersUsecase } from './usecase';
import type { TaskRepository } from '@domain/task/repository';
import type { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import type { ScheduledTask, Task } from '@domain/task';
import { DEFAULT_USER_SETTINGS, type UserSettings } from '@domain/user';
import {
  makeTask,
  makeUser,
  mockConversationRepository,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

describe('SendPendingRemindersUsecase', () => {
  let usecase: SendPendingRemindersUsecase;
  let taskRepository: jest.Mocked<TaskRepository>;
  let notificationGateway: jest.Mocked<NotificationGateway>;
  let conversations: ReturnType<typeof mockConversationRepository>;

  // 12:00Z = 17:00 in Tashkent: outside the default 23:00–07:00 quiet hours.
  const now = new Date('2026-04-16T12:00:00Z');

  /** Makes claimDueReminder hand out these tasks one per call, then null. */
  function queueClaims(tasks: Task[], previousLastSentAt?: Date) {
    const queue = [...tasks];
    taskRepository.claimDueReminder.mockImplementation(async () => {
      const task = queue.shift();
      return task
        ? {
            task: { ...task, lastSentAt: now } as ScheduledTask,
            previousLastSentAt,
          }
        : null;
    });
  }

  function setup(
    settings: Partial<UserSettings> = {},
    timezone = 'Asia/Tashkent',
  ) {
    taskRepository = mockTaskRepository();
    taskRepository.update.mockImplementation(async (p) =>
      makeTask({ id: p.id }),
    );
    notificationGateway = {
      sendReminder: jest.fn().mockResolvedValue({ messageId: 900 }),
      sendDigest: jest.fn(),
      sendDocument: jest.fn(),
      sendSourceLink: jest.fn(),
      sendVoice: jest.fn(),
      upsertPinnedAgenda: jest.fn(),
      removePinnedAgenda: jest.fn(),
    };
    conversations = mockConversationRepository();
    const users = mockUserRepository(
      makeUser({
        timezone,
        settings: { ...structuredClone(DEFAULT_USER_SETTINGS), ...settings },
      }),
    );
    usecase = new SendPendingRemindersUsecase(
      taskRepository,
      notificationGateway,
      conversations,
      users,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers({ now });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    setup();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the reminder in the zone the user lives in now, not the zone the task was made in', async () => {
    // Made in Tashkent, owner now in Berlin: the ping reads Berlin time
    // while the series itself still runs on the task's zone.
    setup({}, 'Europe/Berlin');
    queueClaims([
      makeTask({
        id: 'task-1',
        timezone: 'Asia/Tashkent',
        scheduledAt: new Date('2026-04-16T04:00:00Z'), // 09:00 Tashkent
      }),
    ]);
    await usecase.execute();
    expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/Berlin' }),
    );
  });

  it('sends every claimed task with its timezone and due time, and links the message', async () => {
    const snoozed = makeTask({
      id: 'task-2',
      timezone: 'Asia/Tashkent',
      scheduledAt: new Date('2026-04-16T09:00:00Z'),
      snoozedUntil: new Date('2026-04-16T11:30:00Z'),
      recurrence: { type: 'daily' },
    });
    queueClaims([makeTask({ id: 'task-1' }), snoozed]);

    const result = await usecase.execute();

    expect(notificationGateway.sendReminder).toHaveBeenCalledTimes(2);
    expect(notificationGateway.sendReminder).toHaveBeenLastCalledWith({
      chatId: 12345,
      taskId: 'task-2',
      description: 'Buy groceries',
      kind: 'due',
      dueAt: new Date('2026-04-16T11:30:00Z'), // the snooze, not the series time
      allDay: false,
      timezone: 'Asia/Tashkent',
      notes: null,
      recurrence: { type: 'daily' },
    });
    expect(conversations.linkMessage).toHaveBeenLastCalledWith({
      chatId: 12345,
      messageId: 900,
      taskIds: ['task-2'],
      kind: 'reminder',
    });
    expect(result).toEqual({ sentCount: 2, failedCount: 0, heldCount: 0 });
  });

  it('claims before sending, so a crash can never duplicate a reminder', async () => {
    queueClaims([makeTask()]);
    await usecase.execute();
    expect(
      taskRepository.claimDueReminder.mock.invocationCallOrder[0],
    ).toBeLessThan(
      notificationGateway.sendReminder.mock.invocationCallOrder[0]!,
    );
  });

  it('counts failed reminders without stopping', async () => {
    queueClaims([
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ]);
    notificationGateway.sendReminder
      .mockResolvedValueOnce({ messageId: 1 })
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce({ messageId: 2 });

    const result = await usecase.execute();

    expect(result).toEqual({ sentCount: 2, failedCount: 1, heldCount: 0 });
  });

  it('returns zeros when nothing is due, and stops when claiming fails', async () => {
    expect(await usecase.execute()).toEqual({
      sentCount: 0,
      failedCount: 0,
      heldCount: 0,
    });
    taskRepository.claimDueReminder.mockRejectedValue(new Error('db error'));
    expect(await usecase.execute()).toEqual({
      sentCount: 0,
      failedCount: 0,
      heldCount: 0,
    });
  });

  it('keeps the claim after a permanent failure, releases it with a hold after a transient one', async () => {
    queueClaims([makeTask({ id: 'blocked' })]);
    notificationGateway.sendReminder.mockRejectedValueOnce(
      new NotificationFailedError('bot was blocked', undefined, {
        permanent: true,
      }),
    );
    await usecase.execute();
    expect(taskRepository.releaseReminderClaim).not.toHaveBeenCalled();

    const previous = new Date('2026-04-15T12:00:00Z');
    queueClaims([makeTask({ id: 'busy' })], previous);
    notificationGateway.sendReminder.mockRejectedValueOnce(
      new NotificationFailedError('429'),
    );
    await usecase.execute();
    expect(taskRepository.releaseReminderClaim).toHaveBeenCalledWith(
      'busy',
      previous,
      new Date('2026-04-16T12:02:00Z'),
      { countAttempt: true },
    );
  });

  describe('retry with backoff', () => {
    const transient = () =>
      notificationGateway.sendReminder.mockRejectedValueOnce(
        new NotificationFailedError('502'),
      );

    it.each([
      [0, 2],
      [1, 4],
      [2, 8],
      [3, 16],
      [4, 32],
    ])(
      'after %i earlier failures the next hold is %i minutes',
      async (attempts, minutes) => {
        queueClaims([makeTask({ id: 't', reminderAttempts: attempts })]);
        transient();
        await usecase.execute();
        expect(taskRepository.releaseReminderClaim).toHaveBeenCalledWith(
          't',
          undefined,
          new Date(now.getTime() + minutes * 60_000),
          { countAttempt: true },
        );
        expect(taskRepository.markDeliveryFailed).not.toHaveBeenCalled();
      },
    );

    it('gives up after the last attempt: marks the task failed-to-deliver and keeps the claim', async () => {
      queueClaims([makeTask({ id: 't', reminderAttempts: 5 })]);
      transient();
      const result = await usecase.execute();
      expect(taskRepository.markDeliveryFailed).toHaveBeenCalledWith('t', now);
      expect(taskRepository.releaseReminderClaim).not.toHaveBeenCalled();
      expect(result.failedCount).toBe(1);
    });

    it('a send that finally works resets the attempt count', async () => {
      queueClaims([makeTask({ id: 't', reminderAttempts: 3 })]);
      await usecase.execute();
      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 't',
        reminderAttempts: 0,
      });
    });

    it('a first-time send does not write an attempt reset', async () => {
      queueClaims([makeTask({ id: 't' })]);
      await usecase.execute();
      expect(taskRepository.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ reminderAttempts: 0 }),
      );
    });
  });

  describe('"remind me before"', () => {
    it('sends the heads-up first and records it before sending', async () => {
      const dueAt = new Date('2026-04-16T12:30:00Z');
      queueClaims([
        makeTask({
          scheduledAt: dueAt,
          leadMinutes: 30,
          nextFireAt: new Date('2026-04-16T12:00:00Z'),
        }),
      ]);

      await usecase.execute();

      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        leadSentFor: dueAt,
      });
      expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'heads_up', dueAt }),
      );
      expect(taskRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
        notificationGateway.sendReminder.mock.invocationCallOrder[0]!,
      );
    });

    it('a heads-up that comes too late (held, or the bot was down) is sent as the reminder', async () => {
      const dueAt = new Date('2026-04-16T11:50:00Z');
      queueClaims([
        makeTask({
          scheduledAt: dueAt,
          leadMinutes: 60,
          nextFireAt: new Date('2026-04-16T10:50:00Z'),
        }),
      ]);

      await usecase.execute();

      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        leadSentFor: dueAt,
      });
      expect(notificationGateway.sendReminder).toHaveBeenCalledTimes(1);
      expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'due', dueAt }),
      );
    });
  });

  describe('quiet hours', () => {
    const inTheNight = new Date('2026-04-16T20:00:00Z'); // 01:00 in Tashkent

    it('puts a reminder back until the window ends', async () => {
      jest.setSystemTime(inTheNight);
      const previous = new Date('2026-04-15T20:00:00Z');
      queueClaims([makeTask()], previous);

      const result = await usecase.execute();

      expect(notificationGateway.sendReminder).not.toHaveBeenCalled();
      expect(taskRepository.releaseReminderClaim).toHaveBeenCalledWith(
        'task-1',
        previous,
        new Date('2026-04-17T02:00:00Z'), // 07:00 Tashkent
      );
      expect(result).toEqual({ sentCount: 0, failedCount: 0, heldCount: 1 });
    });

    it('lets high priority through when allowed, and only then', async () => {
      jest.setSystemTime(inTheNight);
      queueClaims([makeTask({ priority: 'high' })]);
      await usecase.execute();
      expect(notificationGateway.sendReminder).toHaveBeenCalledTimes(1);

      setup({
        quietHours: {
          ...DEFAULT_USER_SETTINGS.quietHours,
          allowHighPriority: false,
        },
      });
      queueClaims([makeTask({ priority: 'high' })]);
      await usecase.execute();
      expect(notificationGateway.sendReminder).not.toHaveBeenCalled();
    });

    it('is off when disabled', async () => {
      jest.setSystemTime(inTheNight);
      setup({
        quietHours: { ...DEFAULT_USER_SETTINGS.quietHours, enabled: false },
      });
      queueClaims([makeTask()]);
      await usecase.execute();
      expect(notificationGateway.sendReminder).toHaveBeenCalledTimes(1);
    });
  });

  describe('nudges for ignored reminders (steps 30, 120)', () => {
    it('high priority nudges harder: 10, 30 and 60 minutes, whatever the normal steps are', async () => {
      setup({ escalation: { enabled: true, stepsMinutes: [45] } });
      queueClaims([makeTask({ priority: 'high' })]);
      await usecase.execute();
      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        nudgeAt: new Date('2026-04-16T12:10:00Z'),
        nudgeCount: 0,
      });

      // Second nudge 20 minutes after the first (30 - 10), third 30 later.
      const nudgeAt = new Date('2026-04-16T12:00:00Z');
      for (const [count, next] of [
        [0, '2026-04-16T12:20:00Z'],
        [1, '2026-04-16T12:30:00Z'],
        [2, null],
      ] as const) {
        taskRepository.update.mockClear();
        queueClaims([
          makeTask({
            priority: 'high',
            scheduledAt: new Date('2026-04-16T11:00:00Z'),
            nudgeAt,
            nextFireAt: nudgeAt,
            nudgeCount: count,
          }),
        ]);
        await usecase.execute();
        expect(taskRepository.update).toHaveBeenCalledWith({
          id: 'task-1',
          nudgeCount: count + 1,
          nudgeAt: next === null ? null : new Date(next),
        });
      }
    });

    it('high priority still respects the master switch', async () => {
      setup({ escalation: { enabled: false, stepsMinutes: [30, 120] } });
      queueClaims([makeTask({ priority: 'high' })]);
      await usecase.execute();
      expect(taskRepository.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ nudgeCount: 0 }),
      );
    });

    it('after the reminder, schedules the first nudge 30 minutes later', async () => {
      queueClaims([makeTask()]);
      await usecase.execute();
      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        nudgeAt: new Date('2026-04-16T12:30:00Z'),
        nudgeCount: 0,
      });
    });

    it('sends nudge 1, then schedules nudge 2 at the step difference (90 min)', async () => {
      const nudgeAt = new Date('2026-04-16T12:00:00Z');
      queueClaims([
        makeTask({
          scheduledAt: new Date('2026-04-16T11:30:00Z'),
          nudgeAt,
          nextFireAt: nudgeAt,
        }),
      ]);

      await usecase.execute();

      expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'nudge',
          nudgeNumber: 1,
          dueAt: new Date('2026-04-16T11:30:00Z'),
        }),
      );
      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        nudgeCount: 1,
        nudgeAt: new Date('2026-04-16T13:30:00Z'),
      });
    });

    it('after the last step, stops nudging', async () => {
      const nudgeAt = new Date('2026-04-16T12:00:00Z');
      queueClaims([makeTask({ nudgeAt, nextFireAt: nudgeAt, nudgeCount: 1 })]);
      await usecase.execute();
      expect(notificationGateway.sendReminder).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'nudge', nudgeNumber: 2 }),
      );
      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        nudgeCount: 2,
        nudgeAt: null,
      });
    });

    it('never nudges low-priority tasks, or anyone who switched escalation off', async () => {
      queueClaims([makeTask({ priority: 'low' })]);
      await usecase.execute();
      expect(taskRepository.update).not.toHaveBeenCalled();

      setup({ escalation: { enabled: false, stepsMinutes: [30, 120] } });
      queueClaims([makeTask()]);
      await usecase.execute();
      expect(taskRepository.update).not.toHaveBeenCalled();
    });

    it('a pending nudge after escalation was switched off is dropped, not sent', async () => {
      setup({ escalation: { enabled: false, stepsMinutes: [30, 120] } });
      const nudgeAt = new Date('2026-04-16T12:00:00Z');
      queueClaims([makeTask({ nudgeAt, nextFireAt: nudgeAt })]);
      await usecase.execute();
      expect(notificationGateway.sendReminder).not.toHaveBeenCalled();
      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        nudgeAt: null,
      });
    });
  });

  describe('recurring rollover', () => {
    it('rolls an ignored recurring task onto its latest occurrence before sending', async () => {
      const task = makeTask({
        scheduledAt: new Date('2026-04-13T09:00:00Z'),
        snoozedUntil: new Date('2026-04-13T10:00:00Z'),
        recurrence: { type: 'daily' },
        lastSentAt: new Date('2026-04-13T10:00:00Z'),
      });
      taskRepository.findOverdueRecurring.mockResolvedValue([task]);

      await usecase.execute();

      expect(taskRepository.update).toHaveBeenCalledWith({
        id: 'task-1',
        scheduledAt: new Date('2026-04-16T09:00:00Z'),
        snoozedUntil: null,
      });
      expect(taskRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
        taskRepository.claimDueReminder.mock.invocationCallOrder[0]!,
      );
    });

    it('keeps a snooze that is still ahead: "tomorrow 09:00" on a daily 08:00 task fires at 09:00', async () => {
      taskRepository.findOverdueRecurring.mockResolvedValue([
        makeTask({
          scheduledAt: new Date('2026-04-15T08:00:00Z'),
          snoozedUntil: new Date('2026-04-17T09:00:00Z'),
          recurrence: { type: 'daily' },
        }),
      ]);
      await usecase.execute();
      expect(taskRepository.update).not.toHaveBeenCalled();
    });

    it('rolls over in the task timezone', async () => {
      taskRepository.findOverdueRecurring.mockResolvedValue([
        makeTask({
          scheduledAt: new Date('2026-04-13T04:00:00Z'), // 09:00 Tashkent
          timezone: 'Asia/Tashkent',
          recurrence: { type: 'daily' },
        }),
      ]);
      await usecase.execute();
      expect(taskRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledAt: new Date('2026-04-16T04:00:00Z'),
        }),
      );
    });

    it('does not roll a recurring task whose next occurrence is still ahead', async () => {
      taskRepository.findOverdueRecurring.mockResolvedValue([
        makeTask({
          scheduledAt: new Date('2026-04-16T09:00:00Z'),
          recurrence: { type: 'daily' },
        }),
      ]);
      await usecase.execute();
      expect(taskRepository.update).not.toHaveBeenCalled();
    });
  });
});
