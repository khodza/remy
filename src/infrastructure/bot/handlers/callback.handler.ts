import { Injectable, Inject } from '@nestjs/common';
import { Context } from 'grammy';
import { MarkCompleteUsecase } from '@usecases/task/mark-complete';
import { DelayTaskUsecase } from '@usecases/task/delay-task';
import { DeleteTaskUsecase } from '@usecases/task/delete-task';
import { UpdateTimezoneUsecase } from '@usecases/user/update-timezone';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { TaskRepository } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import { formatForUser } from '@common/format-date';
import { ignoreNotModified } from '../telegram-safe';
import { toEnsureUserInput } from '../user-input';

/** Short text shown as the toast after a button tap. */
type Toast = string;

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

    // Every callback is answered exactly once, here, so Telegram never
    // shows a spinner until timeout and we never answer twice.
    let toast: Toast;
    try {
      toast = await this.dispatch(ctx, data);
    } catch (error) {
      console.error('Failed to handle callback:', error);
      toast = '❌ Action failed';
    }
    await ctx.answerCallbackQuery({ text: toast }).catch(() => undefined);
  }

  private async dispatch(ctx: Context, data: string): Promise<Toast> {
    if (data.startsWith('complete:')) return this.handleComplete(ctx, data);
    if (data.startsWith('delay:')) return this.handleDelay(ctx, data);
    if (data.startsWith('delete:')) return this.handleDelete(ctx, data);
    if (data.startsWith('tz:')) return this.handleTimezone(ctx, data);
    return '🤔 Unknown action';
  }

  private async handleComplete(ctx: Context, data: string): Promise<Toast> {
    const taskId = data.replace('complete:', '');
    const denied = await this.ownershipProblem(ctx, taskId);
    if (denied) return denied;

    const task = await this.markCompleteUsecase.execute({ taskId });
    const repeat = describeRecurrence(task.recurrence);

    if (repeat) {
      // Recurring tasks advance instead of completing; tell the user when
      // the next occurrence is so "Done" doesn't look like it deleted it.
      await ignoreNotModified(
        ctx.editMessageText(
          `✅ <b>Done!</b>\n\n📝 ${escapeHtml(task.description)}\n🔁 Repeats ${repeat}\n⏭ Next: ${formatForUser(task.scheduledAt, task.timezone)}`,
          { parse_mode: 'HTML' },
        ),
      );
      return task.alreadyDone
        ? '✅ Already done for this time'
        : '✅ Done for this time!';
    }

    await ignoreNotModified(
      ctx.editMessageText(
        `✅ <b>Task completed!</b>\n\n📝 ${escapeHtml(task.description)}`,
        { parse_mode: 'HTML' },
      ),
    );
    return task.alreadyDone
      ? '✅ Already completed'
      : '✅ Task marked as complete!';
  }

  private async handleDelay(ctx: Context, data: string): Promise<Toast> {
    const parts = data.split(':');
    if (parts.length !== 3) return '❌ Invalid delay format';

    const taskId = parts[1] ?? '';
    const minutes = parseInt(parts[2] ?? '0', 10);

    const denied = await this.ownershipProblem(ctx, taskId);
    if (denied) return denied;

    const task = await this.delayTaskUsecase.execute({
      taskId,
      delayMinutes: minutes,
    });

    await ignoreNotModified(
      ctx.editMessageText(
        `⏰ <b>Snoozed</b>\n\n📝 ${escapeHtml(task.description)}\n⏭ Reminding again at ${formatForUser(task.nextFireAt, task.timezone)}`,
        { parse_mode: 'HTML' },
      ),
    );
    return `⏰ Delayed by ${minutes} minutes`;
  }

  private async handleDelete(ctx: Context, data: string): Promise<Toast> {
    const taskId = data.replace('delete:', '');
    const denied = await this.ownershipProblem(ctx, taskId);
    if (denied) return denied;

    await this.deleteTaskUsecase.execute({ taskId });

    await ignoreNotModified(
      ctx.editMessageText('🗑️ <b>Task deleted.</b>', { parse_mode: 'HTML' }),
    );
    return '🗑️ Task deleted!';
  }

  private async handleTimezone(ctx: Context, data: string): Promise<Toast> {
    if (ctx.from === undefined) return '❌ Action failed';

    const timezone = data.replace('tz:', '');
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    await this.updateTimezoneUsecase.execute({ userId: user.id, timezone });

    await ignoreNotModified(
      ctx.editMessageText(
        `✅ <b>Timezone updated!</b>\n\n🕐 New timezone: ${escapeHtml(timezone)}`,
        { parse_mode: 'HTML' },
      ),
    );
    return '✅ Timezone updated!';
  }

  /**
   * Returns a toast when the tapping user may not act on this task, null
   * when they may.
   */
  private async ownershipProblem(
    ctx: Context,
    taskId: string,
  ): Promise<Toast | null> {
    if (!ctx.from) return '❌ Action failed';

    const task = await this.taskRepository.findById(taskId);
    if (!task) return '❌ Task not found';

    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    if (task.userId !== user.id) return '❌ Unauthorized';
    return null;
  }
}
