import { InlineKeyboard } from 'grammy';
import { formatInTimeZone } from 'date-fns-tz';
import type { Task } from '@domain/task';
import type {
  Digest,
  MorningBrief,
  ReviewItem,
  ReviewState,
  WeeklyWrap,
} from '@domain/rhythm';
import { effectiveDueAt } from '@common/fire-time';
import { getEnv } from '@common/config';
import { BRIEF_MAX_OVERDUE, BRIEF_MAX_TODAY } from '@usecases/rhythm';
import { escapeHtml } from '../html';
import type { BotReply } from './assistant.presenter';

const INBOX_NAME_MAX = 30;

export function presentDigest(
  digest: Digest,
  now: Date = new Date(),
): BotReply {
  switch (digest.kind) {
    case 'brief':
      return presentBrief(digest);
    case 'review':
      return presentReview(digest, now);
    case 'wrap':
      return presentWrap(digest);
  }
}

// ------------------------------------------------------------------ brief ---

export function presentBrief(brief: MorningBrief): BotReply {
  const tz = brief.timezone;
  const lines: string[] = [
    brief.scheduled
      ? `☀️ <b>Good morning, ${escapeHtml(brief.firstName)}!</b>`
      : '📋 <b>Your day</b>',
    `<i>${formatInTimeZone(brief.now, tz, 'EEEE, d MMMM')}</i>`,
    '',
  ];
  let n = 0;

  const today = brief.today.slice(0, BRIEF_MAX_TODAY);
  if (today.length === 0) {
    lines.push('Nothing scheduled for today.');
  } else {
    lines.push(`<b>Today</b> · ${brief.today.length}`);
    for (const task of today) {
      n++;
      lines.push(
        `${n}. <b>${time(task, tz, 'HH:mm')}</b> ${escapeHtml(task.description)}${marks(task)}`,
      );
    }
    if (brief.today.length > today.length) {
      lines.push(`   …and ${brief.today.length - today.length} more`);
    }
  }

  const overdue = brief.overdue.slice(0, BRIEF_MAX_OVERDUE);
  if (overdue.length > 0) {
    lines.push('', `🔴 <b>Overdue</b> · ${brief.overdue.length}`);
    for (const task of overdue) {
      n++;
      lines.push(
        `${n}. ${escapeHtml(task.description)} · since ${time(task, tz, 'EEE HH:mm')}${marks(task)}`,
      );
    }
    if (brief.overdue.length > overdue.length) {
      lines.push(`   …and ${brief.overdue.length - overdue.length} more`);
    }
  }

  if (brief.inboxCount > 0) {
    const names = brief.inbox.map((t) =>
      escapeHtml(truncate(t.description, INBOX_NAME_MAX)),
    );
    const more = brief.inboxCount > brief.inbox.length ? ', …' : '';
    lines.push(
      '',
      `📥 <b>Inbox</b> · ${brief.inboxCount} without a date: ${names.join(', ')}${more}`,
    );
  }

  if (n > 0) {
    lines.push(
      '',
      '<i>Reply to this message to act on them: “done with 2”, “move 1 to 18:00”.</i>',
    );
  }
  const keyboard = briefKeyboard(brief.overdue.length > 0);
  return { html: lines.join('\n'), ...(keyboard ? { keyboard } : {}) };
}

/** The brief's buttons; without "Move overdue" once it was used. */
export function briefKeyboard(hasOverdue: boolean): InlineKeyboard | undefined {
  const keyboard = new InlineKeyboard();
  let any = false;
  if (hasOverdue) {
    keyboard.text('⏭ Move overdue to today', 'brief:overdue');
    any = true;
  }
  const appUrl = getEnv().MINI_APP_URL;
  if (appUrl) {
    if (any) keyboard.row();
    // With something overdue the app opens on Catch-up (one card at a time).
    if (hasOverdue) {
      const url = new URL(appUrl);
      url.searchParams.set('screen', 'catchup');
      keyboard.webApp('🧹 Catch up in the app', url.toString());
    } else {
      keyboard.webApp('📋 Open Remy', appUrl);
    }
    any = true;
  }
  return any ? keyboard : undefined;
}

// ----------------------------------------------------------------- review ---

/** Used for the first send and for every redraw after a row is resolved. */
export function presentReview(
  review: ReviewState,
  now: Date = new Date(),
): BotReply {
  const tz = review.timezone;
  const lines: string[] = [
    '🌙 <b>Evening review</b>',
    review.doneToday > 0
      ? `✅ Done today: <b>${review.doneToday}</b>`
      : 'Nothing was marked done today.',
  ];
  if (review.items.length === 0) {
    lines.push('', 'Nothing left open. Good night! 🌙');
    return { html: lines.join('\n') };
  }

  lines.push('', `<b>Still open</b> · ${review.items.length}`);
  review.items.forEach((item, i) =>
    lines.push(reviewLine(item, i + 1, tz, now)),
  );

  const open = review.items.filter((i) => i.outcome === null);
  if (open.length === 0) {
    lines.push('', 'All sorted. Good night! 🌙');
    return { html: lines.join('\n') };
  }

  const keyboard = new InlineKeyboard();
  let rows = 0;
  review.items.forEach((item, i) => {
    if (item.outcome !== null) return;
    // Start a new row between items; a trailing empty row is invalid.
    if (rows++ > 0) keyboard.row();
    const n = i + 1;
    keyboard
      .text(`${n} ✅`, `rv:done:${item.taskId}`)
      .text(`${n} ⏭ Tmrw 09:00`, `rv:tmr:${item.taskId}`);
    if (item.recurring) keyboard.text(`${n} ⏩ Skip`, `rv:skip:${item.taskId}`);
    else keyboard.text(`${n} 📥 No date`, `rv:inbox:${item.taskId}`);
  });
  if (open.length >= 2)
    keyboard.row().text('⏭ All open → tomorrow 09:00', 'rv:all');
  return { html: lines.join('\n'), keyboard };
}

function reviewLine(
  item: ReviewItem,
  n: number,
  tz: string,
  now: Date,
): string {
  const title = escapeHtml(item.title);
  switch (item.outcome) {
    case null: {
      const sameDay =
        formatInTimeZone(item.dueAt, tz, 'yyyy-MM-dd') ===
        formatInTimeZone(now, tz, 'yyyy-MM-dd');
      return `${n}. <b>${title}</b> · ${formatInTimeZone(item.dueAt, tz, sameDay ? 'HH:mm' : 'EEE HH:mm')}`;
    }
    case 'done':
      return `${n}. ✅ <s>${title}</s>`;
    case 'tomorrow':
      return `${n}. ⏭ ${title} → ${item.newDueAt ? formatInTimeZone(item.newDueAt, tz, 'EEE HH:mm') : 'tomorrow'}`;
    case 'inbox':
      return `${n}. 📥 ${title} → Inbox, no date`;
    case 'skipped':
      return item.newDueAt
        ? `${n}. ⏩ ${title} → next ${formatInTimeZone(item.newDueAt, tz, 'EEE d MMM, HH:mm')}`
        : `${n}. ⏩ ${title} (that was the last one)`;
    case 'gone':
      return `${n}. ▫️ <s>${title}</s> (already handled)`;
  }
}

// ------------------------------------------------------------------- wrap ---

export function presentWrap(wrap: WeeklyWrap): BotReply {
  const tz = wrap.timezone;
  const lastDay = new Date(wrap.weekEnd.getTime() - 1);
  const sameMonth =
    formatInTimeZone(wrap.weekStart, tz, 'MM') ===
    formatInTimeZone(lastDay, tz, 'MM');
  const range = `${formatInTimeZone(wrap.weekStart, tz, sameMonth ? 'd' : 'd MMM')}–${formatInTimeZone(lastDay, tz, 'd MMM')}`;

  const lines: string[] = [`📊 <b>Your week</b> · ${range}`, ''];
  lines.push(
    wrap.done > 0
      ? `✅ <b>${wrap.done}</b> ${wrap.done === 1 ? 'thing' : 'things'} done`
      : '✅ Nothing marked done this week.',
  );
  if (wrap.streakDays >= 2) {
    lines.push(`🔥 ${wrap.streakDays}-day streak of getting something done`);
  }
  if (wrap.overdueNow > 0) {
    lines.push(
      `🔴 ${wrap.overdueNow} still overdue. Ask me “what's overdue?” to go through them.`,
    );
  }
  if (wrap.mostSnoozed.length > 0) {
    const list = wrap.mostSnoozed
      .map((s) => `“${escapeHtml(s.title)}” (${s.count}×)`)
      .join(', ');
    lines.push(
      `😴 Snoozed again and again: ${list}. Give them a real slot, or drop them?`,
    );
  }
  if (wrap.nextWeekCount > 0) {
    const busiest = wrap.busiestDay
      ? ` · busiest ${formatInTimeZone(wrap.busiestDay.day, tz, 'EEE d MMM')} (${wrap.busiestDay.count})`
      : '';
    lines.push(`📅 Next 7 days: ${wrap.nextWeekCount} scheduled${busiest}`);
  } else {
    lines.push('📅 Nothing scheduled for the next 7 days yet.');
  }
  return { html: lines.join('\n') };
}

// ---------------------------------------------------------------- helpers ---

function time(task: Task, tz: string, pattern: string): string {
  const due = effectiveDueAt(task);
  return due ? formatInTimeZone(due, tz, pattern) : '—';
}

function marks(task: Task): string {
  return `${task.recurrence ? ' 🔁' : ''}${task.priority === 'high' ? ' ❗' : ''}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
