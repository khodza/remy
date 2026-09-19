import { Injectable } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { ListTasksUsecase } from '@usecases/task/list-tasks';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import { formatForUserShort } from '@common/format-date';
import type { Recurrence, Task } from '@domain/task';
import { toEnsureUserInput } from '../user-input';

/** Commands shown in Telegram's "/" menu. Keep in sync with /help. */
export const BOT_COMMANDS = [
  { command: 'list', description: 'Show your pending reminders' },
  { command: 'delete', description: 'Delete a reminder' },
  { command: 'settings', description: 'Set your timezone' },
  { command: 'help', description: 'How to use Remy' },
] as const;

function repeatLine(recurrence: Recurrence | null | undefined): string {
  const label = describeRecurrence(recurrence);
  return label ? `\n   🔁 ${label}` : '';
}

/** "⏰ Thu 16 Apr, 11:00", "(snoozed until …)" when delayed, "📥 no date" for todos. */
function whenLine(
  task: Pick<Task, 'scheduledAt' | 'snoozedUntil' | 'timezone'>,
): string {
  if (task.scheduledAt === null) return '📥 no date';
  const base = `⏰ ${formatForUserShort(task.scheduledAt, task.timezone)}`;
  return task.snoozedUntil
    ? `${base} (snoozed until ${formatForUserShort(task.snoozedUntil, task.timezone)})`
    : base;
}

@Injectable()
export class CommandHandler {
  constructor(
    private readonly ensureUserUsecase: EnsureUserUsecase,
    private readonly listTasksUsecase: ListTasksUsecase,
  ) {}

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
          `<b>Commands</b>\n` +
          `/list – view your reminders\n` +
          `/delete – delete a reminder\n` +
          `/settings – set your timezone\n` +
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

      // Get tasks
      const result = await this.listTasksUsecase.execute({
        userId: user.id,
        includeCompleted: false,
      });

      if (result.tasks.length === 0) {
        await ctx.reply('📭 You have no pending tasks!');
        return;
      }

      const tasks = result.tasks;
      const tasksWithButtons = tasks.slice(-3);
      const tasksWithoutButtons = tasks.slice(0, -3);

      // Show older tasks as plain text
      if (tasksWithoutButtons.length > 0) {
        let message = `📋 <b>Your Tasks:</b>\n\n`;
        for (const task of tasksWithoutButtons) {
          const emoji = task.isOverdue ? '🔴' : '🟢';
          const status = task.isOverdue ? '(Overdue)' : '';
          message += `${emoji} <b>${escapeHtml(task.description)}</b>\n`;
          message += `   ${whenLine(task)} ${status}${repeatLine(task.recurrence)}\n\n`;
        }
        await ctx.reply(message, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`📋 <b>Your Tasks:</b>`, { parse_mode: 'HTML' });
      }

      // Show last 3 tasks with action buttons
      for (const task of tasksWithButtons) {
        const emoji = task.isOverdue ? '🔴' : '🟢';
        const status = task.isOverdue ? ' (Overdue)' : '';
        const text = `${emoji} <b>${escapeHtml(task.description)}</b>\n${whenLine(task)}${status}${repeatLine(task.recurrence).replace('\n   ', '\n')}`;

        const keyboard = new InlineKeyboard()
          .text('✅ Done', `complete:${task.id}`)
          .text('⏰ Delay', `delay:${task.id}:15`)
          .text('🗑️ Delete', `delete:${task.id}`);

        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
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
      const keyboard = new InlineKeyboard();
      for (const task of result.tasks.slice(0, 10)) {
        // Limit to 10 tasks
        keyboard
          .text(`${task.description.slice(0, 30)}...`, `delete:${task.id}`)
          .row();
      }

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

      await ctx.reply(
        `⚙️ <b>Settings</b>\n\n🕐 Current timezone: ${escapeHtml(currentTimezone)}\n\nPick one below, or open the Mini App: it detects your timezone automatically and lets you search any zone.`,
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
        `Every change has an ↩ Undo for 10 minutes.\n\n` +
        `<b>Commands</b>\n` +
        `/list – pending reminders · /delete – delete one\n` +
        `/settings – timezone · /help – this message`,
      { parse_mode: 'HTML' },
    );
  }
}
