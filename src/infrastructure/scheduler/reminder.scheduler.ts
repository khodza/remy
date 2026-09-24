import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SendPendingRemindersUsecase } from '@usecases/task/send-pending-reminders';
import {
  RefreshPinnedAgendaUsecase,
  SendDailyDigestsUsecase,
} from '@usecases/rhythm';

@Injectable()
export class ReminderScheduler implements OnModuleInit, OnApplicationShutdown {
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly sendPendingRemindersUsecase: SendPendingRemindersUsecase,
    private readonly sendDailyDigestsUsecase: SendDailyDigestsUsecase,
    private readonly refreshPinnedAgenda: RefreshPinnedAgendaUsecase,
  ) {}

  onModuleInit() {
    console.log('✅ ReminderScheduler registered (every minute)');
  }

  // Sends are sequential, so a slow run can outlast a minute; overlapping
  // runs would both send tasks the first hasn't stamped as sent yet.
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  public async sendReminders(): Promise<void> {
    this.inFlight = this.runOnce();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /** Let a run that is mid-send finish before the process exits. */
  public async onApplicationShutdown(): Promise<void> {
    if (this.inFlight) {
      console.log('⏳ Waiting for the current reminder run to finish...');
      await this.inFlight.catch(() => undefined);
    }
  }

  private async runOnce(): Promise<void> {
    try {
      const result = await this.sendPendingRemindersUsecase.execute();
      if (
        result.sentCount > 0 ||
        result.failedCount > 0 ||
        result.heldCount > 0
      ) {
        console.log(
          `📊 [CRON] Reminders sent: ${result.sentCount}, failed: ${result.failedCount}, held for quiet hours: ${result.heldCount}`,
        );
      }
    } catch (error) {
      console.error('❌ [CRON] Error in reminder scheduler:', error);
    }
    // Separate try: a failing digest must not stop reminders, and vice versa.
    try {
      const digests = await this.sendDailyDigestsUsecase.execute();
      if (digests.sent > 0 || digests.failed > 0) {
        console.log(
          `📰 [CRON] Digests sent: ${digests.sent}, failed: ${digests.failed}`,
        );
      }
    } catch (error) {
      console.error('❌ [CRON] Error in digest scheduler:', error);
    }
    // Last: the pinned agenda shows whatever the two above changed, plus
    // deferred edits and slots that turned overdue since the last tick.
    try {
      await this.refreshPinnedAgenda.executeAll();
    } catch (error) {
      console.error('❌ [CRON] Error in pinned agenda refresh:', error);
    }
  }
}
