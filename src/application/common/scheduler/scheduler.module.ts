import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReminderScheduler } from '@infra/scheduler/reminder.scheduler';
import { TaskModule } from '../task/task.module';

@Module({
  imports: [ScheduleModule.forRoot(), TaskModule],
  providers: [ReminderScheduler],
})
export class RemindersSchedulerModule {}
