import { Injectable, Inject } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { MarkCompleteUsecase } from '@usecases/task/mark-complete';
import { DelayTaskUsecase } from '@usecases/task/delay-task';
import { SnoozeTaskUsecase } from '@usecases/task/snooze-task';
import { DeleteTaskUsecase } from '@usecases/task/delete-task';
import { UpdateTimezoneUsecase } from '@usecases/user/update-timezone';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import { UndoActionUsecase, UndoRecorder } from '@usecases/assistant';
import type { ConversationRepository } from '@domain/conversation';
import type { Task, TaskRepository } from '@domain/task/repository';
import type { User } from '@domain/user';
import { Domain } from '@common/tokens';
import { escapeHtml } from '../html';
import { describeRecurrence } from '@common/recurrence';
import { formatForUser } from '@common/format-date';
import {
  type SnoozePresetKey,
  effectiveDueAt,
  snoozePresetTime,
} from '@common/fire-time';
import { ignoreNotModified } from '../telegram-safe';
import { resolveTimezone, toEnsureUserInput } from '../user-input';
import {
  MoveOverdueToTodayUsecase,
  ResolveReviewItemUsecase,
  type ReviewAction,
} from '@usecases/rhythm';
import { briefKeyboard, presentReview } from '../presenters/rhythm.presenter';
import { presentAssistantResult } from '../presenters/assistant.presenter';
import { LIST_CALLBACK_PREFIX } from '../presenters/lists.presenter';
import { AssistantResponder } from '../assistant.responder';
import { CommandHandler } from './command.handler';

/** Short text shown as the toast after a button tap. */
type Toast = string;

/** What the forward "when?" buttons stand for, as if the user had typed it. */
const FORWARD_ANSWERS: Record<string, string> = {
  tonight: 'remind me about this tonight at 20:00',
  tomorrow: 'remind me about this tomorrow at 9:00',
  inbox: 'save this for later with no date',
};

@Injectable()
export class CallbackHandler {
  constructor(
    private readonly markCompleteUsecase: MarkCompleteUsecase,
    private readonly delayTaskUsecase: DelayTaskUsecase,
    private readonly snoozeTaskUsecase: SnoozeTaskUsecase,
    private readonly deleteTaskUsecase: DeleteTaskUsecase,
    private readonly updateTimezoneUsecase: UpdateTimezoneUsecase,
    private readonly ensureUserUsecase: EnsureUserUsecase,
    private readonly undoAction: UndoActionUsecase,
    private readonly undoRecorder: UndoRecorder,
    private readonly responder: AssistantResponder,
    private readonly resolveReview: ResolveReviewItemUsecase,
    private readonly moveOverdue: MoveOverdueToTodayUsecase,
    private readonly commands: CommandHandler,
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
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
    await ctx
      .answerCallbackQuery(toast ? { text: toast } : {})
      .catch(() => undefined);
  }

  private async dispatch(ctx: Context, data: string): Promise<Toast> {
    if (data.startsWith('complete:')) return this.handleComplete(ctx, data);
    if (data.startsWith('delay:')) return this.handleDelay(ctx, data);
    if (data.startsWith('snz:')) return this.handleSnoozePreset(ctx, data);
    if (data.startsWith('delete:')) return this.handleDelete(ctx, data);
    if (data.startsWith('undo:')) return this.handleUndo(ctx, data);
    if (data.startsWith('ans:')) return this.handleAnswer(ctx, data);
    if (data === 'noop') return '';
    if (data.startsWith('fwd:')) return this.handleForwardWhen(ctx, data);
    if (data.startsWith('tz:')) return this.handleTimezone(ctx, data);
    if (data.startsWith('rv:')) return this.handleReview(ctx, data);
    if (data === 'brief:overdue') return this.handleBriefOverdue(ctx);
    if (data.startsWith(LIST_CALLBACK_PREFIX)) {
      await this.commands.showList(
        ctx,
        data.slice(LIST_CALLBACK_PREFIX.length),
      );
      return '';
    }
    return '🤔 Unknown action';
  }

  private async handleComplete(ctx: Context, data: string): Promise<Toast> {
    const [, taskId = '', occurrence] = data.split(':');
    const owned = await this.ownedTask(ctx, taskId);
    if (typeof owned === 'string') return owned;
    const { task: before, user } = owned;

    const task = await this.markCompleteUsecase.execute({
      taskId: before.id,
      ...(occurrence !== undefined
        ? { occurrenceAt: new Date(Number(occurrence) * 1000) }
        : {}),
    });
    const keyboard = task.alreadyDone
      ? undefined
      : await this.undoKeyboard(ctx, user, before, 'completed');
    const timezone = resolveTimezone(user);
    const repeat = describeRecurrence(task.recurrence, timezone);

    if (repeat && task.status === 'pending') {
      // Recurring tasks advance instead of completing; tell the user when
      // the next occurrence is so "Done" doesn't look like it deleted it.
      await this.edit(
        ctx,
        `✅ <b>Done!</b>\n\n📝 ${escapeHtml(task.description)}\n🔁 Repeats ${repeat}\n⏭ Next: ${task.scheduledAt ? formatForUser(task.scheduledAt, timezone) : '—'}`,
        keyboard,
      );
      return task.alreadyDone
        ? '✅ Already done for this time'
        : '✅ Done for this time!';
    }

    await this.edit(
      ctx,
      `✅ <b>Task completed!</b>\n\n📝 ${escapeHtml(task.description)}`,
      keyboard,
    );
    return task.alreadyDone
      ? '✅ Already completed'
      : '✅ Task marked as complete!';
  }

  private async handleDelay(ctx: Context, data: string): Promise<Toast> {
    const parts = data.split(':');
    if (parts.length !== 3) return '❌ Invalid delay format';
    const minutes = parseInt(parts[2] ?? '0', 10);

    const owned = await this.ownedTask(ctx, parts[1] ?? '');
    if (typeof owned === 'string') return owned;
    const { task: before, user } = owned;

    const task = await this.delayTaskUsecase.execute({
      taskId: before.id,
      delayMinutes: minutes,
    });
    await this.showSnoozed(ctx, user, before, task);
    return `⏰ Delayed by ${minutes} minutes`;
  }

  private async handleSnoozePreset(ctx: Context, data: string): Promise<Toast> {
    const [, taskId = '', key = ''] = data.split(':');
    const owned = await this.ownedTask(ctx, taskId);
    if (typeof owned === 'string') return owned;
    const { task: before, user } = owned;

    // Computed at tap time, in the user's zone: the label on an old
    // reminder may say "Tonight 20:00" long after tonight has passed.
    const until = snoozePresetTime(
      key as SnoozePresetKey,
      new Date(),
      resolveTimezone(user),
    );
    if (!until) return '⌛ That time has already passed; pick another';

    const task = await this.snoozeTaskUsecase.execute({
      taskId: before.id,
      until,
    });
    await this.showSnoozed(ctx, user, before, task);
    return '⏰ Snoozed';
  }

  private async handleDelete(ctx: Context, data: string): Promise<Toast> {
    const owned = await this.ownedTask(ctx, data.replace('delete:', ''));
    if (typeof owned === 'string') return owned;
    const { task: before, user } = owned;

    await this.deleteTaskUsecase.execute({ taskId: before.id });
    await this.edit(
      ctx,
      `🗑 <b>Deleted</b>\n\n📝 ${escapeHtml(before.description)}`,
      await this.undoKeyboard(ctx, user, before, 'deleted'),
    );
    return '🗑️ Task deleted!';
  }

  private async handleUndo(ctx: Context, data: string): Promise<Toast> {
    if (!ctx.from) return '❌ Action failed';
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    const result = await this.undoAction.execute({
      undoId: data.replace('undo:', ''),
      chatId: ctx.chat?.id ?? ctx.from.id,
      userId: user.id,
    });
    if (!result.undone) {
      await ignoreNotModified(
        ctx.editMessageReplyMarkup({ reply_markup: undefined }),
      );
      return '⌛ Too late to undo that';
    }
    await this.edit(ctx, `↩ <b>Undone</b>: ${escapeHtml(result.label)}`);
    return '↩ Undone';
  }

  /** A tapped answer to Remy's question is treated exactly like typing it. */
  private async handleAnswer(ctx: Context, data: string): Promise<Toast> {
    if (!ctx.from) return '❌ Action failed';
    const chatId = ctx.chat?.id ?? ctx.from.id;
    const state = await this.conversations.getState(chatId);
    // Buttons of an older question must not answer the one open now: the
    // same index would pick an unrelated option.
    const label = pressedButtonText(ctx, data);
    const option =
      state.pendingQuestion?.options[parseInt(data.replace('ans:', ''), 10)];
    if (
      option === undefined ||
      (label !== undefined && label !== option.slice(0, 40))
    ) {
      await ignoreNotModified(
        ctx.editMessageReplyMarkup({ reply_markup: undefined }),
      );
      return '⌛ That question is no longer open';
    }

    // Keep the choice visible: a tap leaves no message in the chat, and a
    // question with no visible answer reads as if Remy was ignored.
    await ignoreNotModified(
      ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(
          `✓ ${option.slice(0, 40)}`,
          'noop',
        ),
      }),
    );
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    await this.responder.respond(ctx, user, option, {
      source: { type: 'text' },
      answersPendingQuestion: true,
    });
    return option.slice(0, 60);
  }

  /** "When?" for a forwarded message. */
  private async handleForwardWhen(ctx: Context, data: string): Promise<Toast> {
    if (!ctx.from) return '❌ Action failed';
    const text = FORWARD_ANSWERS[data.replace('fwd:', '')];
    if (!text) return '🤔 Unknown action';
    const chatId = ctx.chat?.id ?? ctx.from.id;
    const state = await this.conversations.getState(chatId);
    if (!state.pendingForward)
      return '⌛ I no longer have that message; forward it again';

    await ignoreNotModified(
      ctx.editMessageReplyMarkup({ reply_markup: undefined }),
    );
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    await this.responder.respond(ctx, user, text, { source: { type: 'text' } });
    return '📌 Saving…';
  }

  private async handleTimezone(ctx: Context, data: string): Promise<Toast> {
    if (ctx.from === undefined) return '❌ Action failed';

    const timezone = data.replace('tz:', '');
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    await this.updateTimezoneUsecase.execute({ userId: user.id, timezone });

    await this.edit(
      ctx,
      `✅ <b>Timezone updated!</b>\n\n🕐 New timezone: ${escapeHtml(timezone)}`,
    );
    return '✅ Timezone updated!';
  }

  /** A row button (or "all") on the evening review: act, then redraw the message. */
  private async handleReview(ctx: Context, data: string): Promise<Toast> {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!ctx.from || messageId === undefined) return '❌ Action failed';
    const chatId = ctx.chat?.id ?? ctx.from.id;
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    const [, code = '', taskId = ''] = data.split(':');

    const actions: Record<string, ReviewAction> = {
      done: 'done',
      tmr: 'tomorrow',
      inbox: 'inbox',
      skip: 'skip',
    };
    const result =
      code === 'all'
        ? await this.resolveReview.executeAll({
            chatId,
            messageId,
            userId: user.id,
          })
        : actions[code]
          ? await this.resolveReview.execute({
              chatId,
              messageId,
              userId: user.id,
              taskId,
              action: actions[code],
            })
          : undefined;
    if (result === undefined) return '🤔 Unknown action';
    if (result === null) return '⌛ That review is no longer available';

    const reply = presentReview(result.review);
    await this.edit(ctx, reply.html, reply.keyboard);
    if (!result.changed) return '👌 Already sorted';
    const toasts: Record<string, string> = {
      done: '✅ Done',
      tmr: '⏭ Moved to tomorrow 09:00',
      inbox: '📥 Moved to your Inbox',
      skip: '⏩ Skipped this time',
      all: '⏭ All moved to tomorrow 09:00',
    };
    return toasts[code] ?? '👌';
  }

  /** The brief's "Move overdue to today". */
  private async handleBriefOverdue(ctx: Context): Promise<Toast> {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!ctx.from || messageId === undefined) return '❌ Action failed';
    const chatId = ctx.chat?.id ?? ctx.from.id;
    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    const timezone = resolveTimezone(user);

    const result = await this.moveOverdue.execute({
      userId: user.id,
      chatId,
      timezone,
      taskIds: await this.conversations.findLinkedTaskIds(chatId, messageId),
    });
    const keyboard = briefKeyboard(false);
    await ignoreNotModified(
      ctx.editMessageReplyMarkup(keyboard ? { reply_markup: keyboard } : {}),
    );
    if (result.tasks.length === 0) return '✅ Nothing is overdue any more';

    const reply = presentAssistantResult(
      {
        kind: 'rescheduled',
        tasks: result.tasks,
        skipped: [],
        undoId: result.undoId,
      },
      timezone,
    );
    const sent = await ctx.reply(reply.html, {
      parse_mode: 'HTML',
      ...(reply.keyboard ? { reply_markup: reply.keyboard } : {}),
    });
    await this.conversations
      .linkMessage({
        chatId,
        messageId: sent.message_id,
        taskIds: result.tasks.map((t) => t.id),
        kind: 'confirmation',
      })
      .catch((error: unknown) =>
        console.error('Failed to link moved tasks:', error),
      );
    return `⏭ Moved ${result.tasks.length} to today`;
  }

  private async showSnoozed(
    ctx: Context,
    user: User,
    before: Task,
    after: Task,
  ): Promise<void> {
    // The due time, not nextFireAt: with a heads-up that is an earlier ping.
    const due = effectiveDueAt(after);
    await this.edit(
      ctx,
      `⏰ <b>Snoozed</b>\n\n📝 ${escapeHtml(after.description)}\n⏭ Reminding again at ${due ? formatForUser(due, resolveTimezone(user)) : '—'}`,
      await this.undoKeyboard(ctx, user, before, 'snoozed'),
    );
  }

  private async undoKeyboard(
    ctx: Context,
    user: User,
    before: Task,
    verb: string,
  ): Promise<InlineKeyboard> {
    const undoId = await this.undoRecorder.record({
      chatId: ctx.chat?.id ?? user.telegramUserId,
      userId: user.id,
      label: `${verb} "${before.description}"`,
      before: [before],
    });
    return new InlineKeyboard().text('↩ Undo', `undo:${undoId}`);
  }

  private async edit(
    ctx: Context,
    html: string,
    keyboard?: InlineKeyboard,
  ): Promise<void> {
    await ignoreNotModified(
      ctx.editMessageText(html, {
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    );
  }

  /** The task and the tapping user when they own it; otherwise a toast saying why not. */
  private async ownedTask(
    ctx: Context,
    taskId: string,
  ): Promise<{ task: Task; user: User } | Toast> {
    if (!ctx.from) return '❌ Action failed';

    const task = await this.taskRepository.findById(taskId);
    if (!task || task.status === 'deleted') return '❌ Task not found';

    const user = await this.ensureUserUsecase.execute(
      toEnsureUserInput(ctx.from),
    );
    if (task.userId !== user.id) return '❌ Unauthorized';
    return { task, user };
  }
}

/** The label of the inline button that produced this callback, if Telegram sent the keyboard. */
function pressedButtonText(ctx: Context, data: string): string | undefined {
  const rows = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard ?? [];
  for (const button of rows.flat()) {
    if ('callback_data' in button && button.callback_data === data)
      return button.text;
  }
  return undefined;
}
