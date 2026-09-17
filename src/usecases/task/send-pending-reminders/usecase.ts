import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository } from '@domain/task/repository';
import { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import { Domain } from '@common/tokens';
import { computeLatestOccurrence } from '@common/recurrence';
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

    // Before sending, so a rolled-over task is reminded in this same run
    await this.rollOverMissedOccurrences(now);

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
            recurrence: task.recurrence ?? null,
          });

          // Mark reminder as sent so this occurrence isn't sent again
          await this.taskRepository.update({
            id: task.id,
            lastSentAt: now,
          });

          sentCount++;
        } catch (error) {
          console.error(`Failed to send reminder for task ${task.id}:`, error);
          failedCount++;

          // Retrying can't succeed (e.g. the user blocked the bot), so give
          // up on this occurrence instead of failing again every minute.
          if (error instanceof NotificationFailedError && error.permanent) {
            await this.taskRepository
              .update({ id: task.id, lastSentAt: now })
              .catch((updateError: unknown) => {
                console.error(
                  `Failed to mark task ${task.id} as sent:`,
                  updateError,
                );
              });
          }
        }
      }

      return { sentCount, failedCount };
    } catch (error) {
      console.error('Failed to fetch pending reminders:', error);
      return { sentCount, failedCount };
    }
  }

  /**
   * A recurring task only advances when the user completes it. If they
   * ignore it, move it onto its latest occurrence once the next cycle has
   * arrived; otherwise it would stay on the missed cycle (already reminded)
   * and never remind again.
   */
  private async rollOverMissedOccurrences(now: Date): Promise<void> {
    try {
      const tasks = await this.taskRepository.findOverdueRecurring(now);
      for (const task of tasks) {
        if (!task.recurrence) continue;
        const latest = computeLatestOccurrence(
          task.scheduledAt,
          task.recurrence,
          now,
        );
        if (latest.getTime() === task.scheduledAt.getTime()) continue;

        try {
          await this.taskRepository.update({ id: task.id, scheduledAt: latest });
        } catch (error) {
          console.error(`Failed to roll over task ${task.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to fetch overdue recurring tasks:', error);
    }
  }
}
