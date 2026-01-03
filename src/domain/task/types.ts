export enum TaskStatus {
  Pending = 'pending',
  Completed = 'completed',
  Overdue = 'overdue',
  Deleted = 'deleted',
}

export type Task = {
  id: string;
  userId: string;
  telegramChatId: number;
  description: string;
  scheduledAt: Date;
  status: TaskStatus;
  lastSentAt?: Date; // Track when reminder was last sent to prevent duplicates
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTaskParams = {
  userId: string;
  telegramChatId: number;
  description: string;
  scheduledAt: Date;
};

export type UpdateTaskParams = {
  id: string;
  description?: string;
  scheduledAt?: Date;
  status?: TaskStatus;
  lastSentAt?: Date;
};
