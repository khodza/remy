import type { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import { TaskStatus } from '@domain/task';
import {
  makeTask,
  makeUser,
  mockTaskRepository,
  mockUserRepository,
} from '@test/factories';
import { DigestBuilder } from './digest-builder';
import {
  agendaFingerprint,
  PINNED_AGENDA_DEBOUNCE_MS,
  RefreshPinnedAgendaUsecase,
} from './refresh-pinned-agenda.usecase';

const tz = 'Asia/Tashkent'; // UTC+5
const now = new Date('2026-09-17T05:00:00Z'); // Thu 10:00 local

function notificationsMock(): jest.Mocked<NotificationGateway> {
  return {
    sendReminder: jest.fn(),
    sendDigest: jest.fn(),
    sendDocument: jest.fn(),
    sendSourceLink: jest.fn(),
    sendVoice: jest.fn(),
    upsertPinnedAgenda: jest.fn(async (_agenda, messageId) => ({
      messageId: messageId ?? 500,
    })),
    removePinnedAgenda: jest.fn().mockResolvedValue(undefined),
  };
}

function setup(user = makeUser({ timezone: tz })) {
  const users = mockUserRepository(user);
  const tasks = mockTaskRepository();
  const notifications = notificationsMock();
  const usecase = new RefreshPinnedAgendaUsecase(
    users,
    notifications,
    new DigestBuilder(tasks),
  );
  return { users, tasks, notifications, usecase };
}

const standup = makeTask({
  id: 't1',
  description: 'Standup',
  scheduledAt: new Date('2026-09-17T04:30:00Z'), // 09:30, already overdue
  timezone: tz,
});

describe('RefreshPinnedAgendaUsecase', () => {
  it('does nothing while the setting is off and nothing is pinned', async () => {
    const { usecase, notifications } = setup();
    expect(await usecase.refresh({ userId: 'user-1' }, now)).toBe('off');
    expect(notifications.upsertPinnedAgenda).not.toHaveBeenCalled();
  });

  it('first draw: sends and pins, then remembers the message and its fingerprint', async () => {
    const user = makeUser({ timezone: tz });
    user.settings.pinnedAgenda = true;
    const { usecase, users, tasks, notifications } = setup(user);
    tasks.find.mockImplementation(async (filter) =>
      filter.kind === 'reminder' &&
      filter.statuses.includes(TaskStatus.Pending) &&
      filter.dueAfter
        ? [standup]
        : [],
    );

    expect(await usecase.refresh({ userId: 'user-1' }, now)).toBe('updated');
    expect(notifications.upsertPinnedAgenda).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 42, timezone: tz, today: [standup] }),
      null,
    );
    const state = users.current().pinnedAgenda;
    expect(state).toMatchObject({ messageId: 500, dirty: false });
    expect(state?.updatedAt).toEqual(now);

    // Same agenda a moment later: nothing to redraw.
    notifications.upsertPinnedAgenda.mockClear();
    expect(await usecase.refresh({ userId: 'user-1' }, now)).toBe('unchanged');
    expect(notifications.upsertPinnedAgenda).not.toHaveBeenCalled();
  });

  it('debounces: a change inside 30 s is only noted; the tick draws it', async () => {
    const user = makeUser({ timezone: tz });
    user.settings.pinnedAgenda = true;
    user.pinnedAgenda = {
      messageId: 500,
      fingerprint: 'stale',
      updatedAt: new Date(now.getTime() - 10_000),
      dirty: false,
    };
    const { usecase, users, notifications } = setup(user);

    expect(await usecase.refresh({ telegramUserId: 42 }, now)).toBe('deferred');
    expect(users.current().pinnedAgenda?.dirty).toBe(true);
    expect(notifications.upsertPinnedAgenda).not.toHaveBeenCalled();

    const later = new Date(now.getTime() + PINNED_AGENDA_DEBOUNCE_MS);
    expect(await usecase.executeAll(later)).toEqual({ updated: 1, failed: 0 });
    expect(notifications.upsertPinnedAgenda).toHaveBeenCalledWith(
      expect.anything(),
      500,
    );
    expect(users.current().pinnedAgenda).toMatchObject({
      messageId: 500,
      dirty: false,
      updatedAt: later,
    });
  });

  it('a message that is gone gets replaced: the new id is stored', async () => {
    const user = makeUser({ timezone: tz });
    user.settings.pinnedAgenda = true;
    user.pinnedAgenda = {
      messageId: 500,
      fingerprint: 'stale',
      updatedAt: new Date(now.getTime() - 120_000),
      dirty: true,
    };
    const { usecase, users, notifications } = setup(user);
    notifications.upsertPinnedAgenda.mockResolvedValue({ messageId: 501 });

    expect(await usecase.refresh({ userId: 'user-1' }, now)).toBe('updated');
    expect(users.current().pinnedAgenda?.messageId).toBe(501);
  });

  it('setting off: unpins, deletes and forgets the message', async () => {
    const user = makeUser({ timezone: tz });
    user.pinnedAgenda = {
      messageId: 500,
      fingerprint: 'x',
      updatedAt: now,
      dirty: false,
    };
    const { usecase, users, notifications } = setup(user);

    expect(await usecase.executeAll(now)).toEqual({ updated: 0, failed: 0 });
    expect(notifications.removePinnedAgenda).toHaveBeenCalledWith(42, 500);
    expect(users.current().pinnedAgenda).toBeNull();
  });

  it('refreshes of one user run in order: on then off ends with nothing pinned', async () => {
    const user = makeUser({ timezone: tz });
    const { usecase, users, notifications } = setup(user);
    // Slow first draw, so the "off" refresh arrives while it is in flight.
    notifications.upsertPinnedAgenda.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ messageId: 500 }), 20),
        ),
    );
    await users.update({
      id: user.id,
      settings: { ...user.settings, pinnedAgenda: true },
    });
    const on = usecase.refresh({ userId: 'user-1' }, now);
    // Let the first draw reach Telegram before the setting flips.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await users.update({
      id: user.id,
      settings: { ...user.settings, pinnedAgenda: false },
    });
    const off = usecase.refresh({ userId: 'user-1' }, now);

    expect(await Promise.all([on, off])).toEqual(['updated', 'removed']);
    expect(notifications.removePinnedAgenda).toHaveBeenCalledWith(42, 500);
    expect(users.current().pinnedAgenda).toBeNull();
  });

  it('a blocked bot is not an error: the tick goes on', async () => {
    const user = makeUser({ timezone: tz });
    user.settings.pinnedAgenda = true;
    const { usecase, notifications } = setup(user);
    notifications.upsertPinnedAgenda.mockRejectedValue(
      new NotificationFailedError('blocked', new Error('403'), {
        permanent: true,
      }),
    );
    expect(await usecase.executeAll(now)).toEqual({ updated: 0, failed: 0 });

    notifications.upsertPinnedAgenda.mockRejectedValue(
      new NotificationFailedError('429', new Error('429'), {
        permanent: false,
      }),
    );
    expect(await usecase.executeAll(now)).toEqual({ updated: 0, failed: 1 });
  });
});

describe('agendaFingerprint', () => {
  const base = {
    chatId: 42,
    timezone: tz,
    now,
    today: [standup],
    doneToday: [],
    overdueBefore: 0,
    inboxCount: 2,
  };

  it('ignores the clock but not the day, a task turning overdue, or the counts', () => {
    const fp = agendaFingerprint(base);
    expect(
      agendaFingerprint({ ...base, now: new Date(now.getTime() + 60_000) }),
    ).toBe(fp);
    // 09:00 local: the standup is not overdue yet.
    expect(
      agendaFingerprint({ ...base, now: new Date('2026-09-17T04:00:00Z') }),
    ).not.toBe(fp);
    // Next day.
    expect(
      agendaFingerprint({ ...base, now: new Date('2026-09-18T05:00:00Z') }),
    ).not.toBe(fp);
    expect(agendaFingerprint({ ...base, inboxCount: 3 })).not.toBe(fp);
    expect(
      agendaFingerprint({ ...base, today: [], doneToday: [standup] }),
    ).not.toBe(fp);
  });
});
