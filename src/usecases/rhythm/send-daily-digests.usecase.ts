import { Inject, Injectable } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import type { ConversationRepository } from '@domain/conversation';
import type { NotificationGateway } from '@domain/notification/gateway';
import type { DigestKind } from '@domain/rhythm';
import type { User, UserRepository } from '@domain/user';
import { Domain } from '@common/tokens';
import { getEnv } from '@common/config';
import { DigestBuilder } from './digest-builder';

/** A digest goes out at its time or within this many minutes after (downtime). */
export const DIGEST_WINDOW_MINUTES = 180;

export type SendDailyDigestsOutput = { sent: number; failed: number };

/**
 * Called every minute by the scheduler. For each user, sends the morning
 * brief, the evening review and (on the last day of the week) the weekly
 * wrap once per local day, at the times in their settings.
 */
@Injectable()
export class SendDailyDigestsUsecase {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Notification.Gateway)
    private readonly notifications: NotificationGateway,
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    private readonly builder: DigestBuilder,
  ) {}

  public async execute(
    now: Date = new Date(),
  ): Promise<SendDailyDigestsOutput> {
    let sent = 0;
    let failed = 0;
    let users: User[];
    try {
      users = await this.users.listAll();
    } catch (error) {
      console.error('Failed to list users for digests:', error);
      return { sent, failed };
    }

    for (const user of users) {
      for (const kind of dueDigests(user, now)) {
        try {
          if (await this.sendOne(user, kind, now)) sent++;
        } catch (error) {
          // One failed digest must not stop the others.
          console.error(`Failed to send ${kind} to user ${user.id}:`, error);
          failed++;
        }
      }
    }
    return { sent, failed };
  }

  private async sendOne(
    user: User,
    kind: DigestKind,
    now: Date,
  ): Promise<boolean> {
    const timezone = zoneOf(user);
    // Claim first: two processes (or a slow run overlapping the next) can
    // never both send today's brief.
    const claimed = await this.users.claimDigest(
      user.id,
      kind,
      localDate(now, timezone),
    );
    if (!claimed) return false;

    const chatId = user.telegramUserId;
    if (kind === 'brief') {
      const brief = await this.builder.buildBrief(user, timezone, now, true);
      const sent = await this.notifications.sendDigest(brief);
      if (sent.messageId !== null) {
        await this.conversations.linkMessage({
          chatId,
          messageId: sent.messageId,
          // Same order as the numbers in the message, so "done with 2" works.
          taskIds: briefTaskIds(brief),
          kind: 'agenda',
        });
      }
      return true;
    }
    if (kind === 'review') {
      const review = await this.builder.buildReview(user, timezone, now);
      const sent = await this.notifications.sendDigest(review);
      if (sent.messageId !== null) {
        await this.conversations.saveReview(chatId, sent.messageId, {
          timezone: review.timezone,
          doneToday: review.doneToday,
          items: review.items,
        });
      }
      return true;
    }
    const wrap = await this.builder.buildWrap(user, timezone, now);
    await this.notifications.sendDigest(wrap);
    return true;
  }
}

/** The numbered tasks of a brief, in display order (capped like the message). */
export function briefTaskIds(brief: {
  today: { id: string }[];
  overdue: { id: string }[];
}): string[] {
  return [
    ...brief.today.slice(0, BRIEF_MAX_TODAY),
    ...brief.overdue.slice(0, BRIEF_MAX_OVERDUE),
  ].map((t) => t.id);
}
export const BRIEF_MAX_TODAY = 15;
export const BRIEF_MAX_OVERDUE = 10;

export function zoneOf(user: Pick<User, 'timezone'>): string {
  return user.timezone ?? getEnv().OWNER_TIMEZONE ?? 'UTC';
}

function localDate(now: Date, timezone: string): string {
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Which digests are due for this user right now (not yet claimed ones only). */
export function dueDigests(user: User, now: Date): DigestKind[] {
  const timezone = zoneOf(user);
  const local = minutesOf(formatInTimeZone(now, timezone, 'HH:mm'));
  const inWindow = (time: string): boolean => {
    const at = minutesOf(time);
    return local >= at && local < at + DIGEST_WINDOW_MINUTES;
  };
  const s = user.settings;
  const kinds: DigestKind[] = [];
  if (s.morningBrief.enabled && inWindow(s.morningBrief.time))
    kinds.push('brief');
  if (s.eveningReview.enabled && inWindow(s.eveningReview.time))
    kinds.push('review');
  // The wrap goes with the evening, on the last day of the user's week.
  const weekday = Number(formatInTimeZone(now, timezone, 'i')) % 7; // 0 = Sunday
  const lastDayOfWeek = (s.weekStartsOn + 6) % 7;
  if (
    s.weeklyWrap.enabled &&
    weekday === lastDayOfWeek &&
    inWindow(s.eveningReview.time)
  ) {
    kinds.push('wrap');
  }
  return kinds;
}
