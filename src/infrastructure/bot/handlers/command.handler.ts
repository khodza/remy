import { Inject, Injectable } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { ListTasksUsecase } from '@usecases/task/list-tasks';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import { formatForUserShort } from '@common/format-date';
import type { Recurrence, Task } from '@domain/task';
import { resolveTimezone, toEnsureUserInput } from '../user-input';
import type { ConversationRepository } from '@domain/conversation';
import { Domain } from '@common/tokens';
import { getEnv } from '@common/config';
import { DigestBuilder, briefTaskIds } from '@usecases/rhythm';
import { HIGH_PRIORITY_STEPS_MINUTES } from '@usecases/task/send-pending-reminders';
import { ExportDataUsecase } from '@usecases/data';
import { presentBrief } from '../presenters/rhythm.presenter';

function humanDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0
    ? `${minutes / 60} h`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Commands shown in Telegram's "/" menu. Keep in sync with /help. */
export const BOT_COMMANDS = [
  { command: 'today', description: "Today's plan, overdue and inbox" },
  { command: 'list', description: 'Show your pending reminders' },
  { command: 'delete', description: 'Delete a reminder' },
  { command: 'settings', description: 'Timezone, brief times, quiet hours' },
  {
    command: 'export',
    description: 'Everything as a file (CSV, or /export json)',
  },
  { command: 'help', description: 'How to use Remy' },
] as const;

function repeatLine(recurrence: Recurrence | null | undefined): string {
  const label = describeRecurrence(recurrence);
  return label ? `\n   🔁 ${label}` : '';
}

/** "⏰ Thu 16 Apr, 11:00", "(snoozed until …)" when delayed, "📥 no date" for todos. */
function whenLine(
  task: Pick<Task, 'scheduledAt' | 'snoozedUntil'>,
  timezone: string,
): string {
  if (task.scheduledAt === null) return '📥 no date';
  const base = `⏰ ${formatForUserShort(task.scheduledAt, timezone)}`;
  return task.snoozedUntil
    ? `${base} (snoozed until ${formatForUserShort(task.snoozedUntil, timezone)})`
    : base;
}

@Injectable()
export class CommandHandler {
  constructor(
    private readonly ensureUserUsecase: EnsureUserUsecase,
    private readonly listTasksUsecase: ListTasksUsecase,
    private readonly digestBuilder: DigestBuilder,
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    private readonly exportData: ExportDataUsecase,
  ) {}

  /** "/export" sends a CSV, "/export json" the full JSON record. */
  public async handleExport(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;
    const format = /\bjson\b/i.test(ctx.message?.text ?? '') ? 'json' : 'csv';
    try {
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );
      const result = await this.exportData.execute({ userId: user.id, format });
      if (result.tasks === 0)
        await ctx.reply('Nothing to export yet: you have no reminders.');
    } catch (error) {
      console.error('Export failed:', error);
      await ctx.reply('❌ Could not build the export. Try again in a minute.');
    }
  }

  /** The morning brief, on demand. Replies to it act on its numbered tasks. */
  public async handleToday(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;
    try {
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );
      const brief = await this.digestBuilder.buildBrief(
        user,
        resolveTimezone(user),
        new Date(),
        false,
      );
      const reply = presentBrief(brief);
      const sent = await ctx.reply(reply.html, {
        parse_mode: 'HTML',
        ...(reply.keyboard ? { reply_markup: reply.keyboard } : {}),
      });
      await this.conversations
        .linkMessage({
          chatId: ctx.chat?.id ?? ctx.from.id,
          messageId: sent.message_id,
          taskIds: briefTaskIds(brief),
          kind: 'agenda',
        })
        .catch((error: unknown) =>
          console.error('Failed to link /today:', error),
        );
    } catch (error) {
      console.error('Failed to handle today command:', error);
      await ctx.reply('❌ Failed to load your day. Please try again.');
    }
  }

  public async handleStart(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;

    try {
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );

      const timezoneNote = user.timezone
        ? `🕐 Your timezone: ${escapeHtml(user.timezone)} (change it with /settings)`
        : `⚠️ <b>Set your timezone first</b> so times are right: /settings, or open the Mini App and it is detected automatically.`;

      await ctx.reply(
        `👋 <b>Welcome to Remy, your reminder assistant.</b>\n\n` +
          `Just tell me what to remember and when, typed or by voice:\n` +
          `• "Call mom tomorrow at 17:00"\n` +
          `• "Buy milk, dentist Friday 10" (several at once)\n` +
          `• "Take vitamins every day at 9"\n` +
          `• "What's on today?" · "Done with the dentist" · "Move it to 18:00"\n` +
          `• Forward me a message and tell me when\n\n` +
          `Every morning I send your plan for the day and every evening a short review; /settings to change the times.\n\n` +
          `<b>Commands</b>\n` +
          `/today – your day at a glance\n` +
          `/list – view your reminders\n` +
          `/delete – delete a reminder\n` +
          `/settings – timezone, brief times, quiet hours\n` +
          `/help – show help\n\n` +
          timezoneNote,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error('Failed to handle start command:', error);
      await ctx.reply('❌ Something went wrong. Please try again.');
    }
  }

  public async handleList(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;

    try {
      // Ensure user exists
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );
      const timezone = resolveTimezone(user);

      // Get tasks
      const result = await this.listTasksUsecase.execute({
        userId: user.id,
        includeCompleted: false,
      });

      if (result.tasks.length === 0) {
        await ctx.reply('📭 You have no pending tasks!');
        return;
      }

      // Soonest (and overdue) first, todos last: Mongo sorts a null due time
      // before every date. The buttons go on what needs attention now, not
      // on the three tasks furthest away.
      const tasks = [
        ...result.tasks.filter((t) => t.scheduledAt !== null),
        ...result.tasks.filter((t) => t.scheduledAt === null),
      ];
      const tasksWithButtons = tasks.slice(0, 3);
      const tasksWithoutButtons = tasks.slice(3);

      await ctx.reply(`📋 <b>Your Tasks:</b>`, { parse_mode: 'HTML' });

      for (const task of tasksWithButtons) {
        const emoji = task.isOverdue ? '🔴' : '🟢';
        const status = task.isOverdue ? ' (Overdue)' : '';
        const text = `${emoji} <b>${escapeHtml(task.description)}</b>\n${whenLine(task, timezone)}${status}${repeatLine(task.recurrence).replace('\n   ', '\n')}`;

        const keyboard = new InlineKeyboard().text(
          '✅ Done',
          `complete:${task.id}`,
        );
        // A todo has no time to delay from.
        if (task.scheduledAt !== null)
          keyboard.text('⏰ Delay', `delay:${task.id}:15`);
        keyboard.text('🗑️ Delete', `delete:${task.id}`);

        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
      }

      if (tasksWithoutButtons.length > 0) {
        let message = `<b>Later:</b>\n\n`;
        for (const task of tasksWithoutButtons) {
          const emoji = task.isOverdue ? '🔴' : '🟢';
          const status = task.isOverdue ? '(Overdue)' : '';
          message += `${emoji} <b>${escapeHtml(task.description)}</b>\n`;
          message += `   ${whenLine(task, timezone)} ${status}${repeatLine(task.recurrence)}\n\n`;
        }
        await ctx.reply(message, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error('Failed to handle list command:', error);
      await ctx.reply('❌ Failed to fetch tasks. Please try again.');
    }
  }

  public async handleDelete(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;

    try {
      // Ensure user exists
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );

      // Get tasks
      const result = await this.listTasksUsecase.execute({
        userId: user.id,
        includeCompleted: false,
      });

      if (result.tasks.length === 0) {
        await ctx.reply('📭 You have no tasks to delete!');
        return;
      }

      // Create inline keyboard with delete buttons
      // One button per row, at most 10; no trailing empty row.
      const keyboard = new InlineKeyboard();
      result.tasks.slice(0, 10).forEach((task, i) => {
        if (i > 0) keyboard.row();
        const label =
          task.description.length > 30
            ? `${task.description.slice(0, 29)}…`
            : task.description;
        keyboard.text(label, `delete:${task.id}`);
      });

      await ctx.reply('Select a task to delete:', { reply_markup: keyboard });
    } catch (error) {
      console.error('Failed to handle delete command:', error);
      await ctx.reply('❌ Failed to load tasks. Please try again.');
    }
  }

  public async handleSettings(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;

    try {
      // Ensure user exists
      const user = await this.ensureUserUsecase.execute(
        toEnsureUserInput(ctx.from),
      );

      const currentTimezone = user.timezone ?? 'Not set (using UTC)';
      const s = user.settings;
      const weekEnd = s.weekStartsOn === 1 ? 'Sunday' : 'Saturday';
      const rhythm = [
        `☀️ Morning brief: ${s.morningBrief.enabled ? s.morningBrief.time : 'off'}`,
        `🌙 Evening review: ${s.eveningReview.enabled ? s.eveningReview.time : 'off'}` +
          (s.weeklyWrap.enabled ? ` · 📊 weekly wrap on ${weekEnd}` : ''),
        `🔕 Quiet hours: ${
          s.quietHours.enabled
            ? `${s.quietHours.from}–${s.quietHours.to}${s.quietHours.allowHighPriority ? ' (high priority still rings)' : ''}`
            : 'off'
        }`,
        `🔁 If you ignore a reminder: ${
          s.escalation.enabled && s.escalation.stepsMinutes.length > 0
            ? `nudge after ${s.escalation.stepsMinutes.map(humanDelay).join(' and ')}`
            : 'no nudges'
        }${
          s.escalation.enabled
            ? ` · high priority after ${HIGH_PRIORITY_STEPS_MINUTES.map(humanDelay).join(', ')}, low never`
            : ''
        }`,
      ].join('\n');

      // Create inline keyboard with common timezones
      const keyboard = new InlineKeyboard()
        .text('🌍 UTC', 'tz:UTC')
        .text('🇺🇸 America/New_York', 'tz:America/New_York')
        .row()
        .text('🇺🇸 America/Los_Angeles', 'tz:America/Los_Angeles')
        .text('🇬🇧 Europe/London', 'tz:Europe/London')
        .row()
        .text('🇩🇪 Europe/Berlin', 'tz:Europe/Berlin')
        .text('🇯🇵 Asia/Tokyo', 'tz:Asia/Tokyo')
        .row()
        .text('🇺🇿 Asia/Tashkent', 'tz:Asia/Tashkent')
        .text('🇦🇺 Australia/Sydney', 'tz:Australia/Sydney');

      const appUrl = getEnv().MINI_APP_URL;
      if (appUrl) {
        const url = new URL(appUrl);
        url.searchParams.set('screen', 'settings');
        keyboard.row().webApp('⚙️ Change these in the app', url.toString());
      }

      await ctx.reply(
        `⚙️ <b>Settings</b>\n\n🕐 Timezone: ${escapeHtml(currentTimezone)}\n${rhythm}\n\n` +
          (appUrl
            ? 'Change them in the app, or pick a timezone below.'
            : 'Pick a timezone below. Brief times, quiet hours and nudges are changed in the Mini App (Settings).'),
        { reply_markup: keyboard, parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error('Failed to handle settings command:', error);
      await ctx.reply('❌ Failed to load settings. Please try again.');
    }
  }

  public async handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(
      `📚 <b>How to use Remy</b>\n\n` +
        `Just talk to me, typed or by voice.\n\n` +
        `<b>Remember things</b>\n` +
        `• "Call mom tomorrow at 17:00"\n` +
        `• "Buy milk, pay rent on the 1st, dentist Friday 10" (several at once)\n` +
        `• "Flight Saturday 18:00, remind me 3 hours before"\n` +
        `• "Someday: learn to make plov" (no date → Inbox)\n` +
        `• Forward me any message and tell me when\n\n` +
        `<b>Repeating</b>\n` +
        `• "Vitamins every day at 9", "Standup every weekday 9:30"\n` +
        `• "Gym every Mon and Thu at 7 until December"\n` +
        `• "Rent on the last day of every month", "Mom's birthday every year"\n\n` +
        `<b>Ask and manage</b>\n` +
        `• "What's on today?", "What do I have this week?", "Anything overdue?"\n` +
        `• "Done with the dentist", "Move the dentist to 18:00"\n` +
        `• "Push everything today to tomorrow", "Delete the dry cleaning one"\n` +
        `• Reply to any of my messages: "make it 11", "in 2 hours", "done"\n\n` +
        `<b>When it's time</b>\n` +
        `Buttons show the resulting time: ✅ Done, +15m, +1h, Tonight, Tomorrow. ` +
        `Every change has an ↩ Undo for 10 minutes. ` +
        `If you ignore a reminder I nudge you again (after 30 min and 2 h by default; a high-priority one after 10, 30 and 60 min, and it rings through quiet hours), never a low-priority one.\n\n` +
        `<b>Every day</b>\n` +
        `☀️ Morning brief: today's plan, overdue things, your Inbox.\n` +
        `🌙 Evening review: what is still open, with one-tap Done / Tomorrow / No date.\n` +
        `📊 On the last evening of the week: a short wrap-up.\n\n` +
        `<b>Commands</b>\n` +
        `/today – your day at a glance · /list – pending reminders\n` +
        `/delete – delete one · /settings – times, quiet hours, nudges\n` +
        `/export – everything as a CSV file (/export json for the full record)\n` +
        `/help – this message`,
      { parse_mode: 'HTML' },
    );
  }
}
