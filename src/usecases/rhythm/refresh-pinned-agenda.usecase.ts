import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import type { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import type { PinnedAgenda } from '@domain/rhythm';
import type { User, UserRepository } from '@domain/user';
import { Domain } from '@common/tokens';
import { isTaskOverdue } from '@common/all-day';
import { effectiveDueAt } from '@common/fire-time';
import { DigestBuilder } from './digest-builder';
import { zoneOf } from './send-daily-digests.usecase';

/** Two redraws of the pinned agenda are at least this far apart. */
export const PINNED_AGENDA_DEBOUNCE_MS = 30_000;

export type RefreshPinnedAgendaOutcome =
  | 'off'
  | 'removed'
  | 'unchanged'
  | 'deferred'
  | 'updated';

export type UserRef = { userId: string } | { telegramUserId: number };

/**
 * Keeps the one pinned "Today" message per chat in step with the tasks
 * (settings.pinnedAgenda). Called after every change from the bot or the
 * Mini App and by the minute cron, which also draws deferred changes and
 * the passing of time (a slot turning overdue, a new day).
 */
@Injectable()
export class RefreshPinnedAgendaUsecase {
  private readonly logger = new Logger(RefreshPinnedAgendaUsecase.name);
  /** One refresh at a time per user, in arrival order (on, then off). */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Notification.Gateway)
    private readonly notifications: NotificationGateway,
    private readonly builder: DigestBuilder,
  ) {}

  /**
   * Fire-and-forget after a change: a failure here never fails the action
   * that caused it. Inside the debounce window the change is only noted.
   */
  public refreshSoon(ref: UserRef): void {
    void this.refresh(ref).catch((error: unknown) =>
      this.logger.error('Failed to refresh the pinned agenda', error),
    );
  }

  /**
   * Redraws after a change unless the last redraw was under 30 s ago.
   * Refreshes of one user run one after another, so a quick "on, off"
   * cannot leave a message pinned with the setting off.
   */
  public async refresh(
    ref: UserRef,
    now: Date = new Date(),
  ): Promise<RefreshPinnedAgendaOutcome> {
    const user = await this.load(ref);
    if (!user) return 'off';
    return this.enqueue(user.id, async () => {
      // Reloaded inside the queue: the earlier read may predate a change.
      const fresh = await this.users.findById(user.id);
      return fresh ? this.executeForUser(fresh, now, { force: false }) : 'off';
    });
  }

  /** The minute tick: every user whose agenda is on or still pinned. */
  public async executeAll(
    now: Date = new Date(),
  ): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;
    let users: User[];
    try {
      users = await this.users.listAll();
    } catch (error) {
      this.logger.error('Failed to list users for the pinned agenda', error);
      return { updated, failed };
    }
    for (const user of users) {
      if (!user.settings.pinnedAgenda && user.pinnedAgenda === null) continue;
      try {
        const outcome = await this.enqueue(user.id, async () => {
          const fresh = await this.users.findById(user.id);
          return fresh
            ? this.executeForUser(fresh, now, { force: true })
            : 'off';
        });
        if (outcome === 'updated') updated++;
      } catch (error) {
        failed++;
        this.logger.error(
          `Failed to refresh the pinned agenda of user ${user.id}`,
          error,
        );
      }
    }
    return { updated, failed };
  }

  private load(ref: UserRef): Promise<User | null> {
    return 'userId' in ref
      ? this.users.findById(ref.userId)
      : this.users.findByTelegramUserId(ref.telegramUserId);
  }

  private enqueue<T>(userId: string, job: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const run = previous.then(job, job);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(userId, settled);
    void settled.then(() => {
      if (this.queues.get(userId) === settled) this.queues.delete(userId);
    });
    return run;
  }

  public async executeForUser(
    user: User,
    now: Date,
    options: { force: boolean },
  ): Promise<RefreshPinnedAgendaOutcome> {
    const state = user.pinnedAgenda;
    if (!user.settings.pinnedAgenda) {
      if (state === null) return 'off';
      await this.notifications.removePinnedAgenda(
        user.telegramUserId,
        state.messageId,
      );
      await this.users.update({ id: user.id, pinnedAgenda: null });
      return 'removed';
    }

    const timezone = zoneOf(user);
    const agenda = await this.builder.buildPinnedAgenda(user, timezone, now);
    const fingerprint = agendaFingerprint(agenda);

    if (state !== null && state.fingerprint === fingerprint) {
      if (state.dirty) {
        await this.users.update({
          id: user.id,
          pinnedAgenda: { ...state, dirty: false },
        });
      }
      return 'unchanged';
    }
    if (
      !options.force &&
      state !== null &&
      now.getTime() - state.updatedAt.getTime() < PINNED_AGENDA_DEBOUNCE_MS
    ) {
      if (!state.dirty) {
        await this.users.update({
          id: user.id,
          pinnedAgenda: { ...state, dirty: true },
        });
      }
      return 'deferred';
    }

    try {
      const sent = await this.notifications.upsertPinnedAgenda(
        agenda,
        state?.messageId ?? null,
      );
      if (sent.messageId === null) return 'unchanged';
      await this.users.update({
        id: user.id,
        pinnedAgenda: {
          messageId: sent.messageId,
          fingerprint,
          updatedAt: now,
          dirty: false,
        },
      });
      return 'updated';
    } catch (error) {
      // A blocked bot cannot be drawn to; keep the message id so a later
      // /start does not leave an orphan pinned, but stop counting it dirty.
      if (error instanceof NotificationFailedError && error.permanent) {
        this.logger.warn(
          `Pinned agenda of user ${user.id} cannot be drawn: ${error.message}`,
        );
        return 'unchanged';
      }
      throw error;
    }
  }
}

/**
 * What the message shows, minus the clock in its header: the local day,
 * each line's task, time, state and marks, and the footer counts. Only a
 * change here is worth an edit (Telegram rejects identical edits anyway).
 */
export function agendaFingerprint(agenda: PinnedAgenda): string {
  const tz = agenda.timezone;
  const row = (task: PinnedAgenda['today'][number], done: boolean): string =>
    [
      task.id,
      effectiveDueAt(task)?.getTime() ?? 0,
      task.allDay ? 'd' : 't',
      done ? 'done' : isTaskOverdue(task, agenda.now) ? 'late' : 'open',
      task.description,
      task.priority,
      task.recurrence ? 'r' : '',
    ].join(':');
  const parts = [
    formatInTimeZone(agenda.now, tz, 'yyyy-MM-dd'),
    ...agenda.today.map((t) => row(t, false)),
    ...agenda.doneToday.map((t) => row(t, true)),
    `overdue=${agenda.overdueBefore}`,
    `inbox=${agenda.inboxCount}`,
  ];
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}
