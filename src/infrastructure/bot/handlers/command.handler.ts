import { Injectable } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { ListTasksUsecase } from '@usecases/task/list-tasks';
import { format } from 'date-fns';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import type { Recurrence } from '@domain/task';

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

@Injectable()
export class CommandHandler {
  constructor(
    private readonly ensureUserUsecase: EnsureUserUsecase,
    private readonly listTasksUsecase: ListTasksUsecase,
  ) {}

  public async handleStart(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;

    try {
      // Ensure user exists
      await this.ensureUserUsecase.execute({
        telegramUserId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });

      await ctx.reply(
        `👋 <b>Welcome to Remy, your reminder assistant.</b>\n\n` +
          `Just tell me what to remember and when:\n` +
          `• "Remind me to call mom at 5 PM"\n` +
          `• "Meeting tomorrow at 10am"\n` +
          `• "Take vitamins every day at 9"\n` +
          `• Voice messages work too!\n\n` +
          `<b>Commands</b>\n` +
          `/list – view your reminders\n` +
          `/delete – delete a reminder\n` +
          `/settings – set your timezone\n` +
          `/help – show help`,
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
      const user = await this.ensureUserUsecase.execute({
        telegramUserId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });

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
          message += `   ⏰ ${format(task.scheduledAt, 'PPpp')} ${status}${repeatLine(task.recurrence)}\n\n`;
        }
        await ctx.reply(message, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`📋 <b>Your Tasks:</b>`, { parse_mode: 'HTML' });
      }

      // Show last 3 tasks with action buttons
      for (const task of tasksWithButtons) {
        const emoji = task.isOverdue ? '🔴' : '🟢';
        const status = task.isOverdue ? ' (Overdue)' : '';
        const text = `${emoji} <b>${escapeHtml(task.description)}</b>\n⏰ ${format(task.scheduledAt, 'PPpp')}${status}${repeatLine(task.recurrence).replace('\n   ', '\n')}`;

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
      const user = await this.ensureUserUsecase.execute({
        telegramUserId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });

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
      const user = await this.ensureUserUsecase.execute({
        telegramUserId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });

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
        `⚙️ <b>Settings</b>\n\n🕐 Current timezone: ${escapeHtml(currentTimezone)}\n\nSelect your timezone:`,
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
        `<b>Create a reminder</b>\n` +
        `Send a message describing it:\n` +
        `• "Remind me to call mom at 5 PM"\n` +
        `• "Dentist appointment tomorrow at 2pm"\n` +
        `• "Meeting next Monday at 10am"\n` +
        `• Voice messages work too\n\n` +
        `<b>Repeating reminders</b>\n` +
        `• "Take vitamins every day at 9am"\n` +
        `• "Standup every weekday at 9:30"\n` +
        `• "Pay rent every month on the 1st"\n` +
        `• "Water the plants every 3 days"\n` +
        `Tapping ✅ Done on a repeating reminder moves it to the next time.\n\n` +
        `<b>Commands</b>\n` +
        `/list – all pending reminders\n` +
        `/delete – delete a reminder\n` +
        `/settings – set your timezone\n` +
        `/help – this message\n\n` +
        `<b>When it's time</b>\n` +
        `I send the reminder with buttons: ✅ Done, ⏰ +15 min, ⏰ +1 hour.`,
      { parse_mode: 'HTML' },
    );
  }
}
