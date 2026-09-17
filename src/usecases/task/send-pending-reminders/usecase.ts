import { Injectable, Inject } from '@nestjs/common';
import { TaskRepository } from '@domain/task/repository';
import { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import { Domain } from '@common/tokens';
import { computeLatestOccurrence } from '@common/recurrence';
import { addMinutes } from 'date-fns';
import { SendPendingRemindersOutput } from './types';

/** How long to hold a task after a transient send failure. */
const RETRY_DELAY_MINUTES = 2;
/** Safety valve so one run can't loop forever if claims never stop. */
const MAX_SENDS_PER_RUN = 500;

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

    for (let i = 0; i < MAX_SENDS_PER_RUN; i++) {
      let claimed;
      try {
        // Claim first, send second: a crash between the two loses at most
        // one reminder instead of duplicating it, and a second process
        // can never send the same task.
        claimed = await this.taskRepository.claimDueReminder(now);
      } catch (error) {
        console.error('Failed to claim a due reminder:', error);
        break;
      }
      if (!claimed) break;

      const { task, previousLastSentAt } = claimed;
      try {
        await this.notificationGateway.sendReminder({
          chatId: task.telegramChatId,
          taskId: task.id,
          description: task.description,
          scheduledAt: task.nextFireAt,
          timezone: task.timezone,
          recurrence: task.recurrence ?? null,
        });
        sentCount++;
      } catch (error) {
        console.error(`Failed to send reminder for task ${task.id}:`, error);
        failedCount++;

        // Permanent failures (blocked bot, chat gone) keep the claim so we
        // don't retry every minute. Transient ones release it with a short
        // hold so the next run tries again.
        if (error instanceof NotificationFailedError && error.permanent) {
          continue;
        }
        await this.taskRepository
          .releaseReminderClaim(
            task.id,
            previousLastSentAt,
            addMinutes(now, RETRY_DELAY_MINUTES),
          )
          .catch((releaseError: unknown) => {
            console.error(
              `Failed to release claim on task ${task.id}:`,
              releaseError,
            );
          });
      }
    }

    return { sentCount, failedCount };
  }

  /**
   * A recurring task only advances when the user completes it. If they
   * ignore it, move it onto its latest occurrence once the next cycle has
   * arrived; otherwise it would stay on the missed cycle (already reminded)
   * and never remind again. A snooze that belonged to the missed occurrence
   * is dropped with it.
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
          task.timezone,
        );
        if (latest.getTime() === task.scheduledAt.getTime()) continue;

        try {
          await this.taskRepository.update({
            id: task.id,
            scheduledAt: latest,
            snoozedUntil: null,
          });
        } catch (error) {
          console.error(`Failed to roll over task ${task.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to fetch overdue recurring tasks:', error);
    }
  }
}
