import type { Digest } from '@domain/rhythm';
import { SendReminderInput, SentReminder } from './types';

export interface NotificationGateway {
  sendReminder(input: SendReminderInput): Promise<SentReminder>;
  /** Morning brief, evening review or weekly wrap. */
  sendDigest(digest: Digest): Promise<SentReminder>;
}
