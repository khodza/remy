import type { ReviewOutcome, ReviewState } from '@domain/rhythm';
import type {
  ConversationState,
  MessageLink,
  NewUndoRecord,
  PendingForward,
  PendingQuestion,
  UndoRecord,
} from '../types';

export interface ConversationRepository {
  linkMessage(link: MessageLink): Promise<void>;
  findLinkedTaskIds(chatId: number, messageId: number): Promise<string[]>;

  getState(chatId: number): Promise<ConversationState>;
  setPendingQuestion(
    chatId: number,
    question: PendingQuestion | null,
  ): Promise<void>;
  setPendingForward(
    chatId: number,
    forward: PendingForward | null,
  ): Promise<void>;
  setLastTaskIds(chatId: number, taskIds: string[]): Promise<void>;

  saveUndo(record: NewUndoRecord): Promise<string>;
  /**
   * Atomically takes an undo record so it can only be applied once. Null
   * when it does not exist, belongs to another chat, was already used, or
   * has expired.
   */
  takeUndo(id: string, chatId: number, now: Date): Promise<UndoRecord | null>;

  /** Evening review: what the message shows, so its buttons can update it. */
  saveReview(
    chatId: number,
    messageId: number,
    review: ReviewState,
  ): Promise<void>;
  getReview(chatId: number, messageId: number): Promise<ReviewState | null>;
  /**
   * Records what happened to one item. Atomic and first-wins: returns the
   * updated review, or null when the item is unknown or already resolved.
   */
  resolveReviewItem(
    chatId: number,
    messageId: number,
    taskId: string,
    outcome: ReviewOutcome,
    newDueAt: Date | null,
  ): Promise<ReviewState | null>;
}
