import { Inject, Injectable } from '@nestjs/common';
import { addHours, set } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  type Task,
  type TaskRepository,
  TaskStatus,
} from '@domain/task/repository';
import { Domain } from '@common/tokens';
import { dayBoundsInZone } from '@common/day-bounds';
import { effectiveDueAt } from '@common/fire-time';
import { SnoozeTaskUsecase } from '../task/snooze-task';
import { UndoRecorder } from '../assistant/undo-recorder';

export type MoveOverdueResult = { tasks: Task[]; undoId: string | null };

/**
 * The morning brief's "Move overdue to today": each overdue task keeps its
 * time of day, today; if that time has already passed, it goes to the next
 * full hour. Repeating tasks move only this occurrence.
 */
@Injectable()
export class MoveOverdueToTodayUsecase {
  constructor(
    @Inject(Domain.Task.Repository)
    private readonly tasks: TaskRepository,
    private readonly snoozeTask: SnoozeTaskUsecase,
    private readonly undo: UndoRecorder,
  ) {}

  public async execute(input: {
    userId: string;
    chatId: number;
    timezone: string;
    /** The tasks the brief showed; only those still overdue are moved. */
    taskIds: string[];
  }): Promise<MoveOverdueResult> {
    const now = new Date();
    const { start } = dayBoundsInZone(now, input.timezone);

    const candidates: Task[] = [];
    for (const id of input.taskIds) {
      const task = await this.tasks.findById(id);
      const due = task ? effectiveDueAt(task) : null;
      if (
        task &&
        task.userId === input.userId &&
        task.status === TaskStatus.Pending &&
        due !== null &&
        due < start
      ) {
        candidates.push(task);
      }
    }
    if (candidates.length === 0) return { tasks: [], undoId: null };

    const undoId = await this.undo.record({
      chatId: input.chatId,
      userId: input.userId,
      label:
        candidates.length === 1
          ? `moved "${candidates[0]!.description}" to today`
          : `moved ${candidates.length} overdue tasks to today`,
      before: candidates,
    });

    const moved: Task[] = [];
    for (const task of candidates) {
      const until = todayAtSameTime(effectiveDueAt(task)!, now, input.timezone);
      moved.push(await this.snoozeTask.execute({ taskId: task.id, until }));
    }
    return { tasks: moved, undoId };
  }
}

/** Today at the due's local time of day, or the next full hour if that has passed. */
export function todayAtSameTime(due: Date, now: Date, timezone: string): Date {
  const [h = 9, m = 0] = formatInTimeZone(due, timezone, 'HH:mm')
    .split(':')
    .map(Number);
  const zonedNow = toZonedTime(now, timezone);
  const sameTime = fromZonedTime(
    set(zonedNow, { hours: h, minutes: m, seconds: 0, milliseconds: 0 }),
    timezone,
  );
  if (sameTime > now) return sameTime;
  return fromZonedTime(
    set(addHours(zonedNow, 1), { minutes: 0, seconds: 0, milliseconds: 0 }),
    timezone,
  );
}
