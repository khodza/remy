import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReminderScheduler } from '@infra/scheduler/reminder.scheduler';
import { TaskModule } from '../task/task.module';
import { RhythmModule } from '../rhythm/rhythm.module';

@Module({
  imports: [ScheduleModule.forRoot(), TaskModule, RhythmModule],
  providers: [ReminderScheduler],
})
export class RemindersSchedulerModule {}
