import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SendPendingRemindersUsecase } from '@usecases/task/send-pending-reminders';

@Injectable()
export class ReminderScheduler implements OnModuleInit {
  constructor(
    private readonly sendPendingRemindersUsecase: SendPendingRemindersUsecase,
  ) {
    console.log('✅ ReminderScheduler constructor called');
  }

  onModuleInit() {
    console.log('✅ ReminderScheduler initialized - CRON job should be registered');
    console.log('⏰ Next trigger: within 60 seconds');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  public async sendReminders(): Promise<void> {
    try {
      console.log('⏰ [CRON] Reminder scheduler triggered at', new Date().toISOString());
      const result = await this.sendPendingRemindersUsecase.execute();
      console.log(`📊 [CRON] Checked reminders - Sent: ${result.sentCount}, Failed: ${result.failedCount}`);
    } catch (error) {
      console.error('❌ [CRON] Error in reminder scheduler:', error);
    }
  }
}
