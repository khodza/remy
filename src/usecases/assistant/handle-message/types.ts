import type { QueryRange } from '@domain/assistant';
import type { Task } from '@domain/task';

export type HandleMessageInput = {
  userId: string;
  chatId: number;
  text: string;
  timezone: string;
  source: { type: 'text' | 'voice'; messageId?: number };
  /** The bot or user message this one replies to, if any. */
  replyToMessageId?: number;
  /** Text of a replied-to (non-bot) or forwarded message the user refers to. */
  quoted?: { text: string; from: string | null };
  /** The text is a tapped answer option of the pending question. */
  answersPendingQuestion?: boolean;
};

export type AssistantResult =
  | { kind: 'created'; tasks: Task[]; undoId: string }
  | { kind: 'agenda'; range: QueryRange; search: string | null; tasks: Task[] }
  | { kind: 'completed'; tasks: Task[]; undoId: string }
  | {
      kind: 'rescheduled';
      tasks: Task[];
      /** Tasks that could not be moved (new time in the past, todo + shift…). */
      skipped: Task[];
      undoId: string | null;
    }
  | { kind: 'deleted'; tasks: Task[]; undoId: string }
  | { kind: 'edited'; task: Task; undoId: string }
  | { kind: 'chat'; reply: string }
  | { kind: 'question'; question: string; options: string[] };

export function taskIdsOf(result: AssistantResult): string[] {
  switch (result.kind) {
    case 'created':
    case 'agenda':
    case 'completed':
    case 'rescheduled':
    case 'deleted':
      return result.tasks.map((t) => t.id);
    case 'edited':
      return [result.task.id];
    default:
      return [];
  }
}
