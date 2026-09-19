import type { Digest } from '@domain/rhythm';
import { SendDocumentInput, SendReminderInput, SentReminder } from './types';

export interface NotificationGateway {
  sendReminder(input: SendReminderInput): Promise<SentReminder>;
  /** Morning brief, evening review or weekly wrap. */
  sendDigest(digest: Digest): Promise<SentReminder>;
  /** A file in the chat, e.g. an export. */
  sendDocument(input: SendDocumentInput): Promise<void>;
}
