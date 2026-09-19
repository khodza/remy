import { Inject, Injectable } from '@nestjs/common';
import type { ConversationRepository } from '@domain/conversation';
import type { ReviewOutcome, ReviewState } from '@domain/rhythm';
import { type TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { snoozePresetTime } from '@common/fire-time';
import { MarkCompleteUsecase } from '../task/mark-complete';
import { SnoozeTaskUsecase } from '../task/snooze-task';
import { UpdateTaskUsecase } from '../task/update-task';
import { SkipOccurrenceUsecase } from '../task/skip-occurrence';

/** What a row button in the evening review asks for. */
export type ReviewAction = 'done' | 'tomorrow' | 'inbox' | 'skip';

export type ResolveReviewResult = {
  review: ReviewState;
  /** False when the row was already resolved (double tap) or unknown. */
  changed: boolean;
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
  ) {}

  public async execute(input: {
    chatId: number;
    messageId: number;
    userId: string;
    taskId: string;
    action: ReviewAction;
  }): Promise<ResolveReviewResult | null> {
    const review = await this.conversations.getReview(
      input.chatId,
      input.messageId,
    );
    if (!review) return null;
    const item = review.items.find((i) => i.taskId === input.taskId);
    if (!item || item.outcome !== null) return { review, changed: false };

    const task = await this.tasks.findById(input.taskId);
    if (task && task.userId !== input.userId) return null;

    let outcome: ReviewOutcome;
    let newDueAt: Date | null = null;
    if (!task || task.status !== TaskStatus.Pending) {
      // Handled elsewhere since the review was sent (chat, app, reminder).
      outcome = task?.status === TaskStatus.Completed ? 'done' : 'gone';
    } else {
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
          if (!until) return { review, changed: false }; // unreachable: tomorrow always exists
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
      return current ? { review: current, changed: false } : null;
    }
    return { review: updated, changed: true };
  }

  /** "All to tomorrow 09:00" for every row that is still open. */
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
    let latest: ResolveReviewResult = { review, changed: false };
    for (const item of review.items.filter((i) => i.outcome === null)) {
      const result = await this.execute({
        ...input,
        taskId: item.taskId,
        action: 'tomorrow',
      });
      if (result)
        latest = {
          review: result.review,
          changed: latest.changed || result.changed,
        };
    }
    return latest;
  }
}
