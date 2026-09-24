import { InlineKeyboard } from 'grammy';
import { differenceInMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Task } from '@domain/task';
import type { AssistantResult } from '@usecases/assistant';
import { describeRecurrence } from '@common/recurrence';
import { effectiveDueAt } from '@common/fire-time';
import { isTaskOverdue } from '@common/all-day';
import {
  formatClockForUser,
  formatForUser,
  formatForUserShort,
} from '@common/format-date';
import { escapeHtml } from '../html';

export type BotReply = { html: string; keyboard?: InlineKeyboard };

const MAX_AGENDA_ITEMS = 25;

const RANGE_TITLES = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'Next 7 days',
  overdue: 'Overdue',
  inbox: 'Inbox (no date)',
  all: 'Everything open',
} as const;

/** AssistantResult → the message Remy sends. All Telegram formatting lives here. */
export function presentAssistantResult(
  result: AssistantResult,
  timezone: string,
  now: Date = new Date(),
): BotReply {
  switch (result.kind) {
    case 'chat':
      return { html: escapeHtml(result.reply) };

    case 'question': {
      const keyboard = new InlineKeyboard();
      // Short answers ("05:00", "17:00") sit side by side; long ones get a
      // row each, or Telegram squeezes them into unreadable "Send noti…".
      const stacked = result.options.some((o) => o.length > 14);
      result.options.forEach((option, i) => {
        if (stacked && i > 0) keyboard.row();
        keyboard.text(option.slice(0, 40), `ans:${i}`);
      });
      return {
        html: `🤔 ${escapeHtml(result.question)}`,
        ...(result.options.length > 0 ? { keyboard } : {}),
      };
    }

    case 'created': {
      if (result.tasks.length === 1) {
        const task = result.tasks[0]!;
        return {
          html: `✅ <b>Saved</b>\n\n${taskBlock(task, timezone)}`,
          keyboard: undoKeyboard(result.undoId),
        };
      }
      const lines = result.tasks.map(
        (t, i) => `${i + 1}. ${taskLine(t, timezone, now)}`,
      );
      return {
        html: `✅ <b>Saved ${result.tasks.length} things</b>\n\n${lines.join('\n')}`,
        keyboard: undoKeyboard(result.undoId, 'Undo all'),
      };
    }

    case 'completed': {
      const lines = result.tasks.map((t) => {
        const repeat = describeRecurrence(t.recurrence, timezone);
        const next =
          repeat && t.scheduledAt && t.status === 'pending'
            ? ` <i>(next: ${formatForUserShort(t.scheduledAt, timezone)})</i>`
            : '';
        return `✅ ${escapeHtml(t.description)}${next}`;
      });
      return { html: lines.join('\n'), keyboard: undoKeyboard(result.undoId) };
    }

    case 'deleted':
      return {
        html: result.tasks
          .map((t) => `🗑 ${escapeHtml(t.description)}`)
          .join('\n'),
        keyboard: undoKeyboard(result.undoId),
      };

    case 'edited':
      return {
        html: `✏️ <b>Updated</b>\n\n${taskBlock(result.task, timezone)}`,
        keyboard: undoKeyboard(result.undoId),
      };

    case 'rescheduled': {
      const lines = result.tasks.map((t) => {
        const due = effectiveDueAt(t);
        const occurrenceOnly =
          t.recurrence && t.snoozedUntil ? ' <i>(this time only)</i>' : '';
        return `⏭ ${escapeHtml(t.description)} → <b>${due ? formatForUserShort(due, timezone, t.allDay) : '—'}</b>${occurrenceOnly}`;
      });
      for (const t of result.skipped) {
        lines.push(
          `⚠️ ${escapeHtml(t.description)}: that time is not in the future, left as is`,
        );
      }
      return {
        html: lines.join('\n'),
        ...(result.undoId ? { keyboard: undoKeyboard(result.undoId) } : {}),
      };
    }

    case 'agenda': {
      const scope = result.list ? `${listTitle(result.list)} · ` : '';
      const title = result.search
        ? `${scope}Matching “${escapeHtml(result.search)}”`
        : result.list && result.range === 'all'
          ? listTitle(result.list)
          : `${scope}${RANGE_TITLES[result.range]}`;
      if (result.tasks.length === 0) {
        return { html: `📭 <b>${title}</b>\n\nNothing here.` };
      }
      const shown = result.tasks.slice(0, MAX_AGENDA_ITEMS);
      const lines = agendaLines(shown, timezone, now);
      const more =
        result.tasks.length > shown.length
          ? `\n…and ${result.tasks.length - shown.length} more`
          : '';
      return {
        html: `📋 <b>${title}</b> · ${result.tasks.length}\n\n${lines.join('\n')}${more}\n\n<i>Reply to this message to act on them: “done with 1”, “move 2 to 6pm”.</i>`,
      };
    }
  }
}

function undoKeyboard(undoId: string, label = 'Undo'): InlineKeyboard {
  return new InlineKeyboard().text(`↩ ${label}`, `undo:${undoId}`);
}

/** Multi-line description used for a single task. */
function taskBlock(task: Task, timezone: string): string {
  const lines = [`📝 ${escapeHtml(task.description)}`];
  const due = effectiveDueAt(task);
  lines.push(
    due
      ? task.allDay
        ? `📅 ${formatForUser(due, timezone, true)}`
        : `⏰ ${formatForUser(due, timezone)}`
      : '📥 No date: saved to your Inbox',
  );
  const repeat = describeRecurrence(task.recurrence, timezone);
  if (repeat) lines.push(`🔁 Repeats ${repeat}`);
  if (task.leadMinutes && due)
    lines.push(`⏳ Heads-up ${task.leadMinutes} min before`);
  if (task.priority === 'high') lines.push('❗ High priority');
  if (task.list) lines.push(`🗂 On your ${escapeHtml(task.list)} list`);
  return lines.join('\n');
}

/** "Shopping list" for the list "shopping". */
export function listTitle(list: string): string {
  return `🗂 ${escapeHtml(list.charAt(0).toUpperCase() + list.slice(1))} list`;
}

/** One-line description used in lists. */
function taskLine(task: Task, timezone: string, now: Date): string {
  const due = effectiveDueAt(task);
  const when = due ? formatForUserShort(due, timezone, task.allDay) : 'no date';
  const repeat = describeRecurrence(task.recurrence, timezone);
  const late = isTaskOverdue(task, now) ? ' 🔴' : '';
  const list = task.list ? ` · 🗂 ${escapeHtml(task.list)}` : '';
  return `<b>${escapeHtml(task.description)}</b> · ${when}${repeat ? ` · 🔁 ${repeat}` : ''}${list}${late}`;
}

/** Numbered lines with a day header whenever the day changes. */
function agendaLines(tasks: Task[], timezone: string, now: Date): string[] {
  const lines: string[] = [];
  let lastDay = '';
  tasks.forEach((task, i) => {
    const due = effectiveDueAt(task);
    const day = due ? formatInTimeZone(due, timezone, 'EEE d MMM') : 'No date';
    if (day !== lastDay) {
      if (lines.length > 0) lines.push('');
      lines.push(`<u>${day}</u>`);
      lastDay = day;
    }
    const time = due ? formatClockForUser(due, timezone, task.allDay) : '📥';
    const overdue =
      due && isTaskOverdue(task, now)
        ? ` 🔴 ${lateBy(differenceInMinutes(now, due))} late`
        : '';
    const repeat = task.recurrence ? ' 🔁' : '';
    lines.push(
      `${i + 1}. <b>${time}</b> ${escapeHtml(task.description)}${repeat}${overdue}`,
    );
  });
  return lines;
}

function lateBy(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (60 * 24))} d`;
}
