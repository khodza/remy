import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository } from '@domain/task/repository';
import { NotificationGateway } from '@domain/notification/gateway';
import { Domain } from '@common/tokens';
import { SendPendingRemindersOutput } from './types';

@Injectable()
export class SendPendingRemindersUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.Notification.Gateway)
    private readonly notificationGateway: NotificationGateway,
  ) {}

  public async execute(): Promise<SendPendingRemindersOutput> {
    const now = new Date();
    let sentCount = 0;
    let failedCount = 0;

    try {
      // Find all pending tasks that should be reminded
      const tasks = await this.taskRepository.findPendingReminders(now);

      // Send reminder for each task
      for (const task of tasks) {
        try {
          await this.notificationGateway.sendReminder({
            chatId: task.telegramChatId,
            taskId: task.id,
            description: task.description,
            scheduledAt: task.scheduledAt,
          });

          // Mark reminder as sent to prevent duplicates
          await this.taskRepository.update({
            id: task.id,
            lastSentAt: now,
          });

          sentCount++;
        } catch (error) {
          console.error(`Failed to send reminder for task ${task.id}:`, error);
          failedCount++;
        }
      }

      return { sentCount, failedCount };
    } catch (error) {
      console.error('Failed to fetch pending reminders:', error);
      return { sentCount, failedCount };
    }
  }
}
