import { Inject, Injectable } from '@nestjs/common';
import type { ConversationRepository } from '@domain/conversation';
import type { ReviewOutcome, ReviewState } from '@domain/rhythm';
import {
  type Task,
  type TaskRepository,
  TaskStatus,
} from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { snoozePresetTime } from '@common/fire-time';
import { MarkCompleteUsecase } from '../task/mark-complete';
import { SnoozeTaskUsecase } from '../task/snooze-task';
import { UpdateTaskUsecase } from '../task/update-task';
import { SkipOccurrenceUsecase } from '../task/skip-occurrence';
import { UndoRecorder } from '../assistant/undo-recorder';

/** What a row button in the evening review asks for. */
export type ReviewAction = 'done' | 'tomorrow' | 'inbox' | 'skip';

export type ResolveReviewResult = {
  review: ReviewState;
  /** False when the row was already resolved (double tap) or unknown. */
  changed: boolean;
  /** Reverses this tap (the Undo row under the review); null when nothing was done. */
  undoId: string | null;
};

const UNDO_LABELS: Record<ReviewAction, string> = {
  done: 'done',
  tomorrow: 'moved to tomorrow',
  inbox: 'moved to the Inbox',
  skip: 'skipped',
};

/**
 * One tap on an evening-review row: do it, record the outcome on the
 * stored review, return the review so the message can be redrawn.
 */
@Injectable()
export class ResolveReviewItemUsecase {
  constructor(
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    private readonly markComplete: MarkCompleteUsecase,
    private readonly snoozeTask: SnoozeTaskUsecase,
    private readonly updateTask: UpdateTaskUsecase,
    private readonly skipOccurrence: SkipOccurrenceUsecase,
    private readonly undo: UndoRecorder,
  ) {}

  public async execute(
    input: {
      chatId: number;
      messageId: number;
      userId: string;
      taskId: string;
      action: ReviewAction;
    },
    /** Set by executeAll, which records one undo for the whole batch. */
    options: { undoId?: string | null } = {},
  ): Promise<ResolveReviewResult | null> {
    const review = await this.conversations.getReview(
      input.chatId,
      input.messageId,
    );
    if (!review) return null;
    const item = review.items.find((i) => i.taskId === input.taskId);
    if (!item || item.outcome !== null)
      return { review, changed: false, undoId: null };

    const task = await this.tasks.findById(input.taskId);
    if (task && task.userId !== input.userId) return null;

    let outcome: ReviewOutcome;
    let newDueAt: Date | null = null;
    let undoId: string | null = null;
    if (!task || task.status !== TaskStatus.Pending) {
      // Handled elsewhere since the review was sent (chat, app, reminder).
      outcome = task?.status === TaskStatus.Completed ? 'done' : 'gone';
    } else {
      // Like every other confirmation: the snapshot is taken before acting.
      undoId =
        options.undoId !== undefined
          ? options.undoId
          : await this.undo.record({
              chatId: input.chatId,
              userId: input.userId,
              label: `${UNDO_LABELS[input.action]} "${task.description}"`,
              before: [task],
            });
      switch (input.action) {
        case 'done':
          await this.markComplete.execute({ taskId: task.id });
          outcome = 'done';
          break;
        case 'tomorrow': {
          const until = snoozePresetTime(
            'tomorrow',
            new Date(),
            review.timezone,
          );
          if (!until) return { review, changed: false, undoId: null }; // unreachable: tomorrow always exists
          await this.snoozeTask.execute({ taskId: task.id, until });
          outcome = 'tomorrow';
          newDueAt = until;
          break;
        }
        case 'skip':
        case 'inbox': {
          // A repeating task can't live in the Inbox; "not now" means skip
          // this occurrence. A one-off goes to the Inbox without a date.
          if (task.recurrence) {
            const skipped = await this.skipOccurrence.execute({
              taskId: task.id,
            });
            outcome = 'skipped';
            newDueAt =
              skipped.status === TaskStatus.Pending
                ? skipped.scheduledAt
                : null;
          } else {
            await this.updateTask.execute({
              taskId: task.id,
              scheduledAt: null,
            });
            outcome = 'inbox';
          }
          break;
        }
      }
    }

    const updated = await this.conversations.resolveReviewItem(
      input.chatId,
      input.messageId,
      input.taskId,
      outcome,
      newDueAt,
    );
    // Null here means a concurrent tap won; show whatever is stored now.
    if (!updated) {
      const current = await this.conversations.getReview(
        input.chatId,
        input.messageId,
      );
      return current ? { review: current, changed: false, undoId: null } : null;
    }
    return { review: updated, changed: true, undoId };
  }

  /** "All to tomorrow 09:00" for every row that is still open, with one Undo. */
  public async executeAll(input: {
    chatId: number;
    messageId: number;
    userId: string;
  }): Promise<ResolveReviewResult | null> {
    const review = await this.conversations.getReview(
      input.chatId,
      input.messageId,
    );
    if (!review) return null;
    const open = review.items.filter((i) => i.outcome === null);

    // One snapshot of every task that is about to move, before any moves.
    const before: Task[] = [];
    for (const item of open) {
      const task = await this.tasks.findById(item.taskId);
      if (
        task &&
        task.userId === input.userId &&
        task.status === TaskStatus.Pending
      )
        before.push(task);
    }
    const undoId =
      before.length > 0
        ? await this.undo.record({
            chatId: input.chatId,
            userId: input.userId,
            label:
              before.length === 1
                ? `moved "${before[0]!.description}" to tomorrow`
                : `moved ${before.length} open tasks to tomorrow`,
            before,
          })
        : null;

    let latest: ResolveReviewResult = { review, changed: false, undoId };
    for (const item of open) {
      const result = await this.execute(
        { ...input, taskId: item.taskId, action: 'tomorrow' },
        { undoId },
      );
      if (result)
        latest = {
          review: result.review,
          changed: latest.changed || result.changed,
          undoId,
        };
    }
    return latest;
  }
}
