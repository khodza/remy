import { SendReminderInput } from './types';

export interface NotificationGateway {
  sendReminder(input: SendReminderInput): Promise<void>;
}
