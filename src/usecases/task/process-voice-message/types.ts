export type ProcessVoiceMessageInput = {
  userId: string;
  telegramChatId: number;
  audioFileBuffer: Buffer;
  mimeType: string;
  userTimezone?: string;
};

export type ProcessVoiceMessageOutput = {
  taskId: string;
  description: string;
  scheduledAt: Date;
  transcribedText: string;
};
