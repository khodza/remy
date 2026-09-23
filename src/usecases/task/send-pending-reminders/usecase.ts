import { Injectable, Inject } from '@nestjs/common';
import { addMinutes } from 'date-fns';
import { TaskRepository } from '@domain/task/repository';
import { NotificationGateway } from '@domain/notification/gateway';
import { NotificationFailedError } from '@domain/notification/errors';
import type { ConversationRepository } from '@domain/conversation';
import type { ScheduledTask } from '@domain/task';
import type { UserRepository, UserSettings } from '@domain/user';
import { DEFAULT_USER_SETTINGS } from '@domain/user';
import { Domain } from '@common/tokens';
import { getEnv } from '@common/config';
import { effectiveDueAt } from '@common/fire-time';
import { isInQuietHours, quietHoursEnd } from '@common/quiet-hours';
import { computeLatestOccurrence } from '@common/recurrence';
import { SendPendingRemindersOutput } from './types';

/** How long to hold a task after a transient send failure. */
const RETRY_DELAY_MINUTES = 2;
/** Safety valve so one run can't loop forever if claims never stop. */
const MAX_SENDS_PER_RUN = 500;

type Ping = 'heads_up' | 'due' | 'nudge';
type Owner = { settings: UserSettings; timezone: string };

@Injectable()
export class SendPendingRemindersUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly taskRepository: TaskRepository,
    @Inject(Domain.Notification.Gateway)
    private readonly notificationGateway: NotificationGateway,
    @Inject(Domain.Conversation.Repository)
    private readonly conversationRepository: ConversationRepository,
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
  ) {}

  public async execute(): Promise<SendPendingRemindersOutput> {
    const now = new Date();
    let sentCount = 0;
    let failedCount = 0;
    let heldCount = 0;
    const owners = new Map<string, Owner>();

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
        const owner = await this.ownerOf(task, owners);

        // Quiet hours: put it back until the window ends. High priority may
        // break through when the user allows it.
        const quiet = owner.settings.quietHours;
        if (
          isInQuietHours(now, owner.timezone, quiet) &&
          !(quiet.allowHighPriority && task.priority === 'high')
        ) {
          await this.taskRepository.releaseReminderClaim(
            task.id,
            previousLastSentAt,
            quietHoursEnd(now, owner.timezone, quiet),
          );
          heldCount++;
          continue;
        }

        const dueAt = effectiveDueAt(task) ?? task.scheduledAt;
        let ping = classify(task);

        if (ping === 'heads_up') {
          // Record the heads-up BEFORE sending: this moves nextFireAt to the
          // due time. If the send then fails we lose a heads-up, never the
          // reminder itself (the other order could strand the task).
          await this.taskRepository.update({
            id: task.id,
            leadSentFor: task.scheduledAt,
          });
          // Held by quiet hours (or the bot was down) until the task was
          // already due: a heads-up would be pointless, send the reminder.
          if (now.getTime() >= dueAt.getTime()) ping = 'due';
        }

        if (ping === 'nudge' && !nudgesAllowed(task, owner.settings)) {
          // Escalation was switched off (or the task made low priority)
          // after the reminder went out: drop the pending nudge silently.
          await this.taskRepository.update({ id: task.id, nudgeAt: null });
          continue;
        }

        const sent = await this.notificationGateway.sendReminder({
          chatId: task.telegramChatId,
          taskId: task.id,
          description: task.description,
          kind: ping,
          dueAt,
          // Shown in the zone the user lives in now, not the one the task
          // was made in; the series itself keeps running on task.timezone.
          timezone: owner.timezone,
          notes: task.notes,
          recurrence: task.recurrence ?? null,
          ...(ping === 'nudge' ? { nudgeNumber: task.nudgeCount + 1 } : {}),
        });
        sentCount++;

        await this.scheduleNextNudge(task, ping, owner.settings, now);

        // Lets "in 2 hours" as a reply to this reminder find its task.
        if (sent.messageId !== null) {
          await this.conversationRepository
            .linkMessage({
              chatId: task.telegramChatId,
              messageId: sent.messageId,
              taskIds: [task.id],
              kind: 'reminder',
            })
            .catch((linkError: unknown) => {
              console.error(
                `Failed to link reminder message for task ${task.id}:`,
                linkError,
              );
            });
        }
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

    return { sentCount, failedCount, heldCount };
  }

  /**
   * Escalation: after the reminder, nudge at each configured step (minutes
   * after the reminder), then stop; the morning brief lists it as overdue.
   */
  private async scheduleNextNudge(
    task: ScheduledTask,
    ping: Ping,
    settings: UserSettings,
    now: Date,
  ): Promise<void> {
    if (ping === 'heads_up') return;
    const steps = settings.escalation.stepsMinutes;
    try {
      if (ping === 'due') {
        const first = steps[0];
        if (!nudgesAllowed(task, settings) || first === undefined) return;
        await this.taskRepository.update({
          id: task.id,
          nudgeAt: addMinutes(now, first),
          nudgeCount: 0,
        });
        return;
      }
      // A nudge was just sent.
      const sentIndex = task.nudgeCount; // 0-based index of this nudge's step
      const current = steps[sentIndex];
      const next = steps[sentIndex + 1];
      await this.taskRepository.update({
        id: task.id,
        nudgeCount: sentIndex + 1,
        nudgeAt:
          current !== undefined && next !== undefined
            ? addMinutes(now, next - current)
            : null,
      });
    } catch (error) {
      // The reminder itself went out; losing a nudge is acceptable.
      console.error(
        `Failed to schedule the next nudge for task ${task.id}:`,
        error,
      );
    }
  }

  private async ownerOf(
    task: ScheduledTask,
    cache: Map<string, Owner>,
  ): Promise<Owner> {
    const cached = cache.get(task.userId);
    if (cached) return cached;
    const user = await this.userRepository.findById(task.userId);
    const owner: Owner = {
      settings: user?.settings ?? DEFAULT_USER_SETTINGS,
      // Quiet hours follow where the user is now, not where the task was made.
      timezone: user?.timezone ?? getEnv().OWNER_TIMEZONE ?? task.timezone,
    };
    cache.set(task.userId, owner);
    return owner;
  }

  /**
   * A recurring task only advances when the user completes it. If they
   * ignore it, move it onto its latest occurrence once the next cycle has
   * arrived; otherwise it would stay on the missed cycle (already reminded)
   * and never remind again. A snooze that belonged to the missed occurrence
   * is dropped with it; one that is still ahead ("tomorrow 09:00" on a daily
   * 08:00 task) is a promise to the user and holds the task until it fires.
   */
  private async rollOverMissedOccurrences(now: Date): Promise<void> {
    try {
      const tasks = await this.taskRepository.findOverdueRecurring(now);
      for (const task of tasks) {
        if (!task.recurrence || task.scheduledAt === null) continue;
        if (task.snoozedUntil && task.snoozedUntil.getTime() > now.getTime())
          continue;
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

/** Which ping the claimed fire time stands for. */
function classify(task: ScheduledTask): Ping {
  if (
    task.nudgeAt !== null &&
    task.nextFireAt.getTime() === task.nudgeAt.getTime()
  ) {
    return 'nudge';
  }
  const headsUp =
    task.snoozedUntil === null &&
    task.leadMinutes !== null &&
    task.leadSentFor?.getTime() !== task.scheduledAt.getTime() &&
    task.nextFireAt.getTime() < task.scheduledAt.getTime();
  return headsUp ? 'heads_up' : 'due';
}

function nudgesAllowed(task: ScheduledTask, settings: UserSettings): boolean {
  return settings.escalation.enabled && task.priority !== 'low';
}
