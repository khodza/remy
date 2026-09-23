import type { Task } from '@domain/task';

export type ProcessVoiceMessageInput = {
  userId: string;
  telegramChatId: number;
  audioFileBuffer: Buffer;
  mimeType: string;
  /** Zone the tasks are created in. */
  timezone: string;
  /** 'miniapp' for an in-app recording (default), 'voice' from the chat. */
  sourceType?: 'voice' | 'miniapp';
};

export type ProcessVoiceMessageOutput = {
  tasks: Task[];
  transcribedText: string;
};
