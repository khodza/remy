import { addDays, addMinutes, set } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type FireInputs = {
  scheduledAt: Date | null;
  snoozedUntil: Date | null;
  leadMinutes: number | null;
  /** The occurrence (scheduledAt) the heads-up was already sent for. */
  leadSentFor: Date | null;
};

/**
 * When the scheduler should next ping the user:
 * - todos never fire;
 * - a snooze wins over everything;
 * - with "remind me before", the heads-up fires first (scheduledAt - lead),
 *   and once it was sent for this occurrence the real reminder follows at
 *   scheduledAt.
 */
export function deriveNextFireAt(input: FireInputs): Date | null {
  const { scheduledAt, snoozedUntil, leadMinutes, leadSentFor } = input;
  if (scheduledAt === null) return null;
  if (snoozedUntil) return snoozedUntil;
  const headsUpPending =
    leadMinutes !== null &&
    leadMinutes > 0 &&
    leadSentFor?.getTime() !== scheduledAt.getTime();
  return headsUpPending ? addMinutes(scheduledAt, -leadMinutes) : scheduledAt;
}

/** When the task is actually due for the user (heads-ups don't count). */
export function effectiveDueAt(task: {
  scheduledAt: Date | null;
  snoozedUntil: Date | null;
}): Date | null {
  if (task.scheduledAt === null) return null;
  return task.snoozedUntil ?? task.scheduledAt;
}

export type SnoozePresetKey = 'tonight' | 'tomorrow';
export type SnoozePreset = { key: SnoozePresetKey; label: string; at: Date };

const TONIGHT_HOUR = 20;
const TOMORROW_HOUR = 9;

/**
 * Absolute snooze targets on the user's wall clock. "Tonight" disappears
 * once it is less than an hour away (or already past).
 */
export function snoozePresets(now: Date, timezone: string): SnoozePreset[] {
  const zonedNow = toZonedTime(now, timezone);
  const at = (dayOffset: number, hours: number): Date =>
    fromZonedTime(
      set(addDays(zonedNow, dayOffset), {
        hours,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      }),
      timezone,
    );

  const presets: SnoozePreset[] = [];
  const tonight = at(0, TONIGHT_HOUR);
  if (tonight.getTime() - now.getTime() >= 60 * 60 * 1000) {
    presets.push({ key: 'tonight', label: 'Tonight', at: tonight });
  }
  presets.push({
    key: 'tomorrow',
    label: 'Tomorrow',
    at: at(1, TOMORROW_HOUR),
  });
  return presets;
}

export function snoozePresetTime(
  key: SnoozePresetKey,
  now: Date,
  timezone: string,
): Date | null {
  return snoozePresets(now, timezone).find((p) => p.key === key)?.at ?? null;
}
