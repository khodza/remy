export type ProcessVoiceMessageInput = {
  userId: string;
  telegramChatId: number;
  audioFileBuffer: Buffer;
  mimeType: string;
  userTimezone?: string;
  /** 'voice' from the chat (default) or 'miniapp' for an in-app recording. */
  sourceType?: 'voice' | 'miniapp';
  messageId?: number;
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
