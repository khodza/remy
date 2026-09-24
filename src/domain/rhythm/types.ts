import type { Task } from '@domain/task';
import type { CalendarEvent } from '@domain/integrations/google-calendar';

/** Sent at the morning-brief time (or on /today). */
export type MorningBrief = {
  kind: 'brief';
  chatId: number;
  /** The user's zone; every time in the brief is shown in it. */
  timezone: string;
  now: Date;
  firstName: string;
  /** Pending reminders due today (local day), by time. */
  today: Task[];
  /** Pending reminders due before today. */
  overdue: Task[];
  /** The newest few todos without a date. */
  inbox: Task[];
  inboxCount: number;
  /** True when sent at the scheduled time; false for /today on demand. */
  scheduled: boolean;
  /** Today's Google Calendar events (all-day first), when an account is connected. */
  calendarEvents?: CalendarEvent[];
};

export type ReviewOutcome = 'done' | 'tomorrow' | 'inbox' | 'skipped' | 'gone';

export type ReviewItem = {
  taskId: string;
  title: string;
  /** When it was due (snooze included). */
  dueAt: Date;
  recurring: boolean;
  /** Null until the user picks something for it. */
  outcome: ReviewOutcome | null;
  /** The new due time after "tomorrow" or "skip". */
  newDueAt: Date | null;
};

/** What an evening-review message shows; stored so its buttons can update it. */
export type ReviewState = {
  timezone: string;
  doneToday: number;
  items: ReviewItem[];
};

export type EveningReview = ReviewState & {
  kind: 'review';
  chatId: number;
  now: Date;
};

export type WeeklyWrap = {
  kind: 'wrap';
  chatId: number;
  timezone: string;
  /** First instant of the first local day of the week. */
  weekStart: Date;
  /** End (exclusive) of today, the last day of the week. */
  weekEnd: Date;
  /** One-off completions plus Done taps on repeating tasks this week. */
  done: number;
  /** Consecutive local days, up to today, with at least one thing done. */
  streakDays: number;
  overdueNow: number;
  /** Open tasks snoozed 4+ times: candidates to drop or give a real slot. */
  mostSnoozed: { title: string; count: number }[];
  nextWeekCount: number;
  busiestDay: { day: Date; count: number } | null;
};

export type Digest = MorningBrief | EveningReview | WeeklyWrap;
export type DigestKind = 'brief' | 'review' | 'wrap';
