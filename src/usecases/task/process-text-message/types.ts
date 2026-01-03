export type ProcessTextMessageInput = {
  userId: string;
  telegramChatId: number;
  text: string;
  userTimezone?: string;
};

export type ProcessTextMessageOutput = {
  taskId: string;
  description: string;
  scheduledAt: Date;
};
