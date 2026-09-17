export type ProcessVoiceMessageInput = {
  userId: string;
  telegramChatId: number;
  audioFileBuffer: Buffer;
  mimeType: string;
  userTimezone?: string;
};

import type { Recurrence } from '@domain/task';

export type ProcessVoiceMessageOutput = {
  taskId: string;
  description: string;
  scheduledAt: Date;
  timezone: string;
  recurrence: Recurrence | null;
  transcribedText: string;
};
