import { NotificationFailedError } from '@domain/notification/errors';
import {
  SendDailyDigestsUsecase,
  dueDigests,
} from './send-daily-digests.usecase';
import { DigestBuilder } from './digest-builder';
import { DEFAULT_USER_SETTINGS, type UserSettings } from '@domain/user';
import type { NotificationGateway } from '@domain/notification/gateway';
import {
  makeTask,
  makeUser,
  mockConversationRepository,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';

// Tashkent is UTC+5. Local 08:00 = 03:00Z, 21:00 = 16:00Z.
const tz = 'Asia/Tashkent';
const settings = (over: Partial<UserSettings> = {}): UserSettings => ({
  ...structuredClone(DEFAULT_USER_SETTINGS),
  ...over,
});
const user = (over: Partial<UserSettings> = {}) =>
  makeUser({ timezone: tz, telegramUserId: 42, settings: settings(over) });

describe('dueDigests', () => {
  it.each([
    ['07:59', []],
    ['08:00', ['brief']],
    ['10:59', ['brief']], // within the 3-hour catch-up window
    ['11:00', []],
    ['21:00', ['review']],
  ])('on a Thursday at %s local → %p', (local, expected) => {
    const [h, m] = local.split(':').map(Number);
    const now = new Date(Date.UTC(2026, 8, 17, h! - 5, m!)); // Thu 17 Sep 2026
    expect(dueDigests(user(), now)).toEqual(expected);
  });

  it('adds the weekly wrap on the last day of the week only, at review time', () => {
    const sunday21 = new Date('2026-09-20T16:00:00Z');
    const saturday21 = new Date('2026-09-19T16:00:00Z');
    expect(dueDigests(user(), sunday21)).toEqual(['review', 'wrap']); // week starts Monday
    expect(dueDigests(user(), saturday21)).toEqual(['review']);
    expect(dueDigests(user({ weekStartsOn: 0 }), saturday21)).toEqual([
      'review',
      'wrap',
    ]);
    expect(
      dueDigests(user({ weeklyWrap: { enabled: false } }), sunday21),
    ).toEqual(['review']);
  });

  it('respects disabled digests and custom times', () => {
    const at0800 = new Date('2026-09-17T03:00:00Z');
    expect(
      dueDigests(
        user({ morningBrief: { enabled: false, time: '08:00' } }),
        at0800,
      ),
    ).toEqual([]);
    expect(
      dueDigests(
        user({ morningBrief: { enabled: true, time: '07:30' } }),
        at0800,
      ),
    ).toEqual(['brief']);
  });
});

describe('SendDailyDigestsUsecase', () => {
  const at0800 = new Date('2026-09-17T03:00:00Z');
  const at2100 = new Date('2026-09-20T16:00:00Z'); // Sunday

  function setup(u = user()) {
    const tasks = mockTaskRepository();
    const users = mockUserRepository(u);
    const conversations = mockConversationRepository();
    const notifications: jest.Mocked<NotificationGateway> = {
      sendReminder: jest.fn(),
      sendDigest: jest.fn().mockResolvedValue({ messageId: 700 }),
      sendDocument: jest.fn(),
    };
    const usecase = new SendDailyDigestsUsecase(
      users,
      notifications,
      conversations,
      new DigestBuilder(tasks),
    );
    return { tasks, users, conversations, notifications, usecase };
  }

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('sends the brief once per local day and links its numbered tasks in display order', async () => {
    const { tasks, notifications, conversations, usecase } = setup();
    const today = makeTask({
      id: 'today',
      scheduledAt: new Date('2026-09-17T09:00:00Z'),
    });
    const overdue = makeTask({
      id: 'old',
      scheduledAt: new Date('2026-09-15T09:00:00Z'),
    });
    tasks.find
      .mockResolvedValueOnce([today]) // today
      .mockResolvedValueOnce([overdue]) // overdue
      .mockResolvedValueOnce([]); // inbox

    expect(await usecase.execute(at0800)).toEqual({ sent: 1, failed: 0 });
    expect(await usecase.execute(new Date('2026-09-17T03:01:00Z'))).toEqual({
      sent: 0,
      failed: 0,
    });

    expect(notifications.sendDigest).toHaveBeenCalledTimes(1);
    expect(notifications.sendDigest.mock.calls[0]![0]).toMatchObject({
      kind: 'brief',
      chatId: 42,
      timezone: tz,
      scheduled: true,
      today: [today],
      overdue: [overdue],
    });
    expect(conversations.linkMessage).toHaveBeenCalledWith({
      chatId: 42,
      messageId: 700,
      taskIds: ['today', 'old'],
      kind: 'agenda',
    });
  });

  it('stores the evening review so its buttons can update it, and sends the wrap on Sunday', async () => {
    const { tasks, notifications, conversations, usecase } = setup();
    tasks.find.mockResolvedValue([]);
    tasks.find.mockResolvedValueOnce([
      makeTask({
        id: 'open',
        description: 'Pay bill',
        scheduledAt: new Date('2026-09-20T06:00:00Z'),
      }),
    ]);

    expect(await usecase.execute(at2100)).toEqual({ sent: 2, failed: 0 });

    expect(notifications.sendDigest.mock.calls.map((c) => c[0].kind)).toEqual([
      'review',
      'wrap',
    ]);
    expect(conversations.saveReview).toHaveBeenCalledWith(42, 700, {
      timezone: tz,
      doneToday: 0,
      items: [
        {
          taskId: 'open',
          title: 'Pay bill',
          dueAt: new Date('2026-09-20T06:00:00Z'),
          recurring: false,
          outcome: null,
          newDueAt: null,
        },
      ],
    });
  });

  it('a failing digest is counted and does not stop the next one', async () => {
    const { tasks, notifications, usecase } = setup();
    tasks.find.mockResolvedValue([]);
    notifications.sendDigest.mockRejectedValueOnce(new Error('telegram down'));
    expect(await usecase.execute(at2100)).toEqual({ sent: 1, failed: 1 });
  });

  it('a Telegram hiccup does not cost the day: the next run sends the brief', async () => {
    const { tasks, notifications, usecase } = setup();
    tasks.find.mockResolvedValue([]);
    notifications.sendDigest.mockRejectedValueOnce(new Error('telegram down'));
    expect(await usecase.execute(at0800)).toEqual({ sent: 0, failed: 1 });
    expect(await usecase.execute(at0800)).toEqual({ sent: 1, failed: 0 });
  });

  it('a blocked bot is not retried every minute', async () => {
    const { tasks, notifications, usecase } = setup();
    tasks.find.mockResolvedValue([]);
    notifications.sendDigest.mockRejectedValueOnce(
      new NotificationFailedError('blocked', undefined, { permanent: true }),
    );
    expect(await usecase.execute(at0800)).toEqual({ sent: 0, failed: 1 });
    expect(await usecase.execute(at0800)).toEqual({ sent: 0, failed: 0 });
  });
});
