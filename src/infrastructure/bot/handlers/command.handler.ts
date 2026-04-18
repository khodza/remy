import { Injectable } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { ListTasksUsecase } from '@usecases/task/list-tasks';
import { format } from 'date-fns';

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
        `👋 *Welcome to Remy - Your Task Reminder Bot!*\n\n` +
          `I'll help you remember important tasks. Just send me a message like:\n` +
          `• "Remind me to call mom at 5 PM"\n` +
          `• "Meeting tomorrow at 10am"\n` +
          `• Voice messages work too!\n\n` +
          `*Commands:*\n` +
          `/list - View your tasks\n` +
          `/delete - Delete a task\n` +
          `/settings - Configure timezone\n` +
          `/help - Show this help`,
        { parse_mode: 'Markdown' },
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
        let message = `📋 *Your Tasks:*\n\n`;
        for (const task of tasksWithoutButtons) {
          const emoji = task.isOverdue ? '🔴' : '🟢';
          const status = task.isOverdue ? '(Overdue)' : '';
          message += `${emoji} *${task.description}*\n`;
          message += `   ⏰ ${format(task.scheduledAt, 'PPpp')} ${status}\n\n`;
        }
        await ctx.reply(message, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`📋 *Your Tasks:*`, { parse_mode: 'Markdown' });
      }

      // Show last 3 tasks with action buttons
      for (const task of tasksWithButtons) {
        const emoji = task.isOverdue ? '🔴' : '🟢';
        const status = task.isOverdue ? ' (Overdue)' : '';
        const text = `${emoji} *${task.description}*\n⏰ ${format(task.scheduledAt, 'PPpp')}${status}`;

        const keyboard = new InlineKeyboard()
          .text('✅ Done', `complete:${task.id}`)
          .text('⏰ Delay', `delay:${task.id}:15`)
          .text('🗑️ Delete', `delete:${task.id}`);

        await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
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
        `⚙️ *Settings*\n\n🕐 Current timezone: ${currentTimezone}\n\nSelect your timezone:`,
        { reply_markup: keyboard, parse_mode: 'Markdown' },
      );
    } catch (error) {
      console.error('Failed to handle settings command:', error);
      await ctx.reply('❌ Failed to load settings. Please try again.');
    }
  }

  public async handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(
      `📚 *Remy Help*\n\n` +
        `*Creating Tasks:*\n` +
        `Send me a message describing your task:\n` +
        `• "Remind me to call mom at 5 PM"\n` +
        `• "Dentist appointment tomorrow at 2pm"\n` +
        `• "Meeting next Monday at 10am"\n` +
        `• You can also send voice messages!\n\n` +
        `*Commands:*\n` +
        `/list - View all your pending tasks\n` +
        `/delete - Delete a task\n` +
        `/settings - Set your timezone\n` +
        `/help - Show this help message\n\n` +
        `*Reminders:*\n` +
        `When it's time, I'll send you a reminder with buttons to:\n` +
        `• ✅ Mark as complete\n` +
        `• ⏰ Delay by 15 minutes or 1 hour`,
      { parse_mode: 'Markdown' },
    );
  }
}
