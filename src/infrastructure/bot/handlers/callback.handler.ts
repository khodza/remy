import { Injectable, Inject } from '@nestjs/common';
import { Context } from 'grammy';
import { MarkCompleteUsecase } from '@usecases/task/mark-complete';
import { DelayTaskUsecase } from '@usecases/task/delay-task';
import { DeleteTaskUsecase } from '@usecases/task/delete-task';
import { UpdateTimezoneUsecase } from '@usecases/user/update-timezone';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { TaskRepository } from '@domain/task/repository';
import { Domain } from '@common/tokens';

@Injectable()
export class CallbackHandler {
  constructor(
    private readonly markCompleteUsecase: MarkCompleteUsecase,
    private readonly delayTaskUsecase: DelayTaskUsecase,
    private readonly deleteTaskUsecase: DeleteTaskUsecase,
    private readonly updateTimezoneUsecase: UpdateTimezoneUsecase,
    private readonly ensureUserUsecase: EnsureUserUsecase,
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
  ) {}

  public async handle(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (data === undefined) return;

    try {
      if (data.startsWith('complete:')) {
        await this.handleComplete(ctx, data);
      } else if (data.startsWith('delay:')) {
        await this.handleDelay(ctx, data);
      } else if (data.startsWith('delete:')) {
        await this.handleDelete(ctx, data);
      } else if (data.startsWith('tz:')) {
        await this.handleTimezone(ctx, data);
      }
    } catch (error) {
      console.error('Failed to handle callback:', error);
      await ctx.answerCallbackQuery({ text: '❌ Action failed' });
    }
  }

  private async handleComplete(ctx: Context, data: string): Promise<void> {
    const taskId = data.replace('complete:', '');

    // Verify user owns this task
    const isAuthorized = await this.verifyTaskOwnership(ctx, taskId);
    if (!isAuthorized) return;

    await this.markCompleteUsecase.execute({ taskId });

    await ctx.answerCallbackQuery({ text: '✅ Task marked as complete!' });
    await ctx.editMessageText('✅ *Task completed!*', {
      parse_mode: 'Markdown',
    });
  }

  private async handleDelay(ctx: Context, data: string): Promise<void> {
    const parts = data.split(':');
    if (parts.length !== 3) {
      await ctx.answerCallbackQuery({ text: '❌ Invalid delay format' });
      return;
    }

    const taskId = parts[1] ?? '';
    const minutes = parseInt(parts[2] ?? '0', 10);

    // Verify user owns this task
    const isAuthorized = await this.verifyTaskOwnership(ctx, taskId);
    if (!isAuthorized) return;

    await this.delayTaskUsecase.execute({
      taskId: taskId,
      delayMinutes: minutes,
    });

    await ctx.answerCallbackQuery({ text: `⏰ Delayed by ${minutes} minutes` });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  }

  private async handleDelete(ctx: Context, data: string): Promise<void> {
    const taskId = data.replace('delete:', '');

    // Verify user owns this task
    const isAuthorized = await this.verifyTaskOwnership(ctx, taskId);
    if (!isAuthorized) return;

    await this.deleteTaskUsecase.execute({ taskId });

    await ctx.answerCallbackQuery({ text: '🗑️ Task deleted!' });
    await ctx.editMessageText('🗑️ *Task deleted successfully!*', {
      parse_mode: 'Markdown',
    });
  }

  private async handleTimezone(ctx: Context, data: string): Promise<void> {
    if (ctx.from === undefined) return;

    const timezone = data.replace('tz:', '');

    // Ensure user exists
    const user = await this.ensureUserUsecase.execute({
      telegramUserId: ctx.from.id,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      username: ctx.from.username,
    });

    // Update timezone
    await this.updateTimezoneUsecase.execute({
      userId: user.id,
      timezone: timezone,
    });

    await ctx.answerCallbackQuery({ text: '✅ Timezone updated!' });
    await ctx.editMessageText(
      `✅ *Timezone updated!*\n\n🕐 New timezone: ${timezone}`,
      { parse_mode: 'Markdown' },
    );
  }

  /**
   * Verify that the current user owns the task
   * Returns true if authorized, false otherwise
   */
  private async verifyTaskOwnership(
    ctx: Context,
    taskId: string,
  ): Promise<boolean> {
    if (!ctx.from) return false;

    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      await ctx.answerCallbackQuery({ text: '❌ Task not found' });
      return false;
    }

    // Check if task belongs to the current user
    if (task.userId !== ctx.from.id.toString()) {
      await ctx.answerCallbackQuery({ text: '❌ Unauthorized' });
      return false;
    }

    return true;
  }
}
