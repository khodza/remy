import { Inject, Injectable } from '@nestjs/common';
import type { ConversationRepository } from '@domain/conversation';
import { type TaskRepository, TaskStatus } from '@domain/task/repository';
import { Domain } from '@common/tokens';

export type UndoActionOutput =
  | { undone: true; label: string }
  | { undone: false; reason: 'expired_or_used' };

/** Applies an Undo button: exactly once, only within its window. */
@Injectable()
export class UndoActionUsecase {
  constructor(
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
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
      });
    }
    return { undone: true, label: record.label };
  }
}
