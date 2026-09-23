import { Inject, Injectable } from '@nestjs/common';
import { addMinutes } from 'date-fns';
import type {
  ConversationRepository,
  TaskSnapshot,
} from '@domain/conversation';
import type { Task } from '@domain/task';
import { Domain } from '@common/tokens';

export const UNDO_WINDOW_MINUTES = 10;

export function snapshotOf(task: Task): TaskSnapshot {
  return {
    taskId: task.id,
    status: task.status,
    description: task.description,
    notes: task.notes,
    scheduledAt: task.scheduledAt,
    snoozedUntil: task.snoozedUntil,
    completedAt: task.completedAt,
    recurrence: task.recurrence,
    completionsCount: task.completions.length,
    nudgeAt: task.nudgeAt,
    nudgeCount: task.nudgeCount,
    snoozeCount: task.snoozeCount,
  };
}

/** Saves what is needed to reverse an action; returns the id for the Undo button. */
@Injectable()
export class UndoRecorder {
  constructor(
    @Inject(Domain.Conversation.Repository)
    private readonly conversations: ConversationRepository,
  ) {}

  public async record(input: {
    chatId: number;
    userId: string;
    label: string;
    before?: Task[];
    createdTaskIds?: string[];
  }): Promise<string> {
    return this.conversations.saveUndo({
      chatId: input.chatId,
      userId: input.userId,
      label: input.label,
      snapshots: (input.before ?? []).map(snapshotOf),
      createdTaskIds: input.createdTaskIds ?? [],
      expiresAt: addMinutes(new Date(), UNDO_WINDOW_MINUTES),
    });
  }
}
