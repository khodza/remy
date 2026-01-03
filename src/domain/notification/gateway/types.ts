export type SendReminderInput = {
  chatId: number;
  taskId: string;
  description: string;
  scheduledAt: Date;
};
