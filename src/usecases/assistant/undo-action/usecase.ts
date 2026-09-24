import { Inject, Injectable } from '@nestjs/common';
import type { ConversationRepository } from '@domain/conversation';
import { type TaskRepository, TaskStatus } from '@domain/task/repository';
import type { UserRepository } from '@domain/user';
import { Domain } from '@common/tokens';

export type UndoActionOutput =
  | {
      undone: true;
      label: string;
      /** Every task the undo touched (restored or removed). */
      taskIds: string[];
    }
  | { undone: false; reason: 'expired_or_used' };

/** Applies an Undo button: exactly once, only within its window. */
@Injectable()
export class UndoActionUsecase {
  constructor(
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
  ) {}

  public async execute(input: {
    undoId: string;
    chatId: number;
    userId: string;
  }): Promise<UndoActionOutput> {
    const record = await this.conversations.takeUndo(
      input.undoId,
      input.chatId,
      new Date(),
    );
    if (!record || record.userId !== input.userId) {
      return { undone: false, reason: 'expired_or_used' };
    }

    for (const taskId of record.createdTaskIds) {
      await this.tasks.update({ id: taskId, status: TaskStatus.Deleted });
    }
    for (const s of record.snapshots) {
      await this.tasks.update({
        id: s.taskId,
        status: s.status,
        description: s.description,
        notes: s.notes,
        scheduledAt: s.scheduledAt,
        snoozedUntil: s.snoozedUntil,
        completedAt: s.completedAt,
        recurrence: s.recurrence,
        truncateCompletions: s.completionsCount,
        // Putting the old time back counts as a time change, which clears
        // the nudges: an undone "+1h" on a fired reminder would otherwise
        // sit overdue and never ping again.
        ...(s.nudgeAt !== undefined ? { nudgeAt: s.nudgeAt } : {}),
        ...(s.nudgeCount !== undefined ? { nudgeCount: s.nudgeCount } : {}),
        ...(s.snoozeCount !== undefined ? { snoozeCount: s.snoozeCount } : {}),
      });
    }
    if (record.restoreTimezone !== undefined) {
      await this.users.update({
        id: record.userId,
        timezone: record.restoreTimezone,
      });
    }
    return {
      undone: true,
      label: record.label,
      taskIds: [
        ...record.createdTaskIds,
        ...record.snapshots.map((s) => s.taskId),
      ],
    };
  }
}
