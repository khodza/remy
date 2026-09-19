import { SendReminderInput, SentReminder } from './types';

export interface NotificationGateway {
  sendReminder(input: SendReminderInput): Promise<SentReminder>;
}
