import type { Digest, PinnedAgenda } from '@domain/rhythm';
import {
  SendDocumentInput,
  SendReminderInput,
  SendSourceLinkInput,
  SentReminder,
} from './types';

export interface NotificationGateway {
  sendReminder(input: SendReminderInput): Promise<SentReminder>;
  /** Morning brief, evening review or weekly wrap. */
  sendDigest(digest: Digest): Promise<SentReminder>;
  /** A file in the chat, e.g. an export. */
  sendDocument(input: SendDocumentInput): Promise<void>;
  /**
   * Replies in the chat to the message a task came from. Throws
   * SourceMessageGoneError when that message no longer exists.
   */
  sendSourceLink(input: SendSourceLinkInput): Promise<SentReminder>;
  /**
   * Redraws the pinned "Today" message, or sends and pins a new one when
   * there is none yet or the old one is gone. Returns the id that now
   * holds it.
   */
  upsertPinnedAgenda(
    agenda: PinnedAgenda,
    messageId: number | null,
  ): Promise<SentReminder>;
  /** Unpins and deletes the pinned agenda; a message already gone is fine. */
  removePinnedAgenda(chatId: number, messageId: number): Promise<void>;
}
