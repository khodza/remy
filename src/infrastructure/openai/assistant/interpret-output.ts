import { z } from 'zod';
import { addDays, addMinutes, getDay, isValid } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  MAX_RECURRENCE_COUNT,
  computeNextOccurrence,
} from '@common/recurrence';
import { allDayFireTime } from '@common/all-day';
import { dayBoundsInZone } from '@common/day-bounds';
import type {
  CandidateTask,
  Interpretation,
  TaskDraft,
} from '@domain/assistant';
import type { Recurrence } from '@domain/task';

const Local = z.string().nullable();

const RecurrenceOut = z
  .object({
    type: z.enum([
      'daily',
      'weekdays',
      'weekly',
      'monthly',
      'every_n_days',
      'yearly',
    ]),
    interval_days: z.number().int().nullable(),
    interval: z.number().int().nullable(),
    by_weekday: z.array(z.number().int()).nullable(),
    last_day_of_month: z.boolean().nullable(),
    until_local: Local,
    count: z.number().int().nullable(),
  })
  .nullable();

const ModelOutput = z.object({
  intent: z.enum([
    'create',
    'query',
    'complete',
    'reschedule',
    'delete',
    'edit',
    'chat',
    'unclear',
  ]),
  tasks: z.array(
    z.object({
      title: z.string(),
      due_local: Local,
      all_day: z.boolean().nullable(),
      in_minutes: z.number().int().nullable(),
      recurrence: RecurrenceOut,
      priority: z.enum(['low', 'normal', 'high']),
      category: z.string().nullable(),
      lead_minutes: z.number().int().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  query_range: z
    .enum(['today', 'tomorrow', 'week', 'overdue', 'inbox', 'all'])
    .nullable(),
  query_search: z.string().nullable(),
  targets: z.array(z.number().int()),
  due_local: Local,
  in_minutes: z.number().int().nullable(),
  shift_minutes: z.number().int().nullable(),
  new_title: z.string().nullable(),
  new_notes: z.string().nullable(),
  reply: z.string().nullable(),
  question: z.string().nullable(),
  options: z.array(z.string()),
});
export type AssistantModelOutput = z.infer<typeof ModelOutput>;

export type InterpretContext = {
  /** What the user wrote; used to check that a target is really meant. */
  text: string;
  /** Tasks tied to the message by a reply or by being the last touched. */
  contextTaskIds: string[];
  timezone: string;
  now: Date;
  /** Same order as the numbered list shown to the model (1-based). */
  candidates: CandidateTask[];
  categories: string[];
};

const FALLBACK_TEXT =
  'I did not quite get that. What should I remember, and when?';
const FALLBACK_QUESTION: Interpretation = {
  intent: 'unclear',
  question: FALLBACK_TEXT,
  options: [],
};

/**
 * Validates the model's JSON and turns it into a domain Interpretation:
 * wall-clock strings become instants in the user's zone, list numbers
 * become task ids, and anything that does not hold together (no targets, a
 * bad time, an empty title) degrades to a clarifying question instead of a
 * wrong action.
 */
export function interpretAssistantOutput(
  raw: unknown,
  ctx: InterpretContext,
): Interpretation {
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) return FALLBACK_QUESTION;
  const out = parsed.data;

  // Durations are added here, not by the model: LLM clock arithmetic drifts.
  const toInstant = (
    local: string | null,
    inMinutes: number | null = null,
    leadMinutes: number | null = null,
  ): Date | null | 'invalid' => {
    // "saturday 6pm, 3 hours before" comes back with the lead copied into
    // in_minutes as well; a named time plus the same number is the lead.
    if (local !== null && local.trim() !== '' && inMinutes === leadMinutes)
      inMinutes = null;
    if (inMinutes !== null && inMinutes > 0 && inMinutes <= 60 * 24 * 366) {
      return addMinutes(ctx.now, inMinutes);
    }
    if (local === null || local.trim() === '') return null;
    const date = fromZonedTime(local, ctx.timezone);
    return isValid(date) ? date : 'invalid';
  };
  const targetIds = [
    ...new Set(
      out.targets
        .map((n) => ctx.candidates[n - 1]?.id)
        .filter((id): id is string => id !== undefined),
    ),
  ];
  // Acting on an existing task needs a reason to believe it is the one
  // meant: a reply / "it" context, a bulk word, or a word of its title in
  // the message. Otherwise ask instead of touching the wrong task.
  if (
    ['complete', 'reschedule', 'delete', 'edit'].includes(out.intent) &&
    targetIds.length > 0 &&
    !isGrounded(ctx, targetIds)
  ) {
    return {
      intent: 'unclear',
      question: 'Which task do you mean?',
      options: ctx.candidates.slice(0, 4).map((c) => c.title.slice(0, 40)),
    };
  }

  /** For non-create intents: the single task the model restated, if any. */
  const restated =
    out.intent !== 'create' && out.tasks.length === 1
      ? out.tasks[0]
      : undefined;
  const ask = (question: string, options: string[] = []): Interpretation => ({
    intent: 'unclear',
    question,
    options,
  });

  switch (out.intent) {
    case 'create': {
      const tasks: TaskDraft[] = [];
      for (const t of out.tasks) {
        const title = t.title.trim();
        if (title === '') continue;
        // "remind me at 5" names no task; a reminder titled "Remind me" is noise.
        if (EMPTY_TITLE.test(title))
          return ask('What should I remind you about?');
        let dueAt = toInstant(t.due_local, t.in_minutes, t.lead_minutes);
        if (dueAt instanceof Date && !t.recurrence && out.tasks.length === 1)
          dueAt = alignToNamedWeekday(dueAt, ctx.text, ctx.timezone);
        if (dueAt === 'invalid')
          return ask(`When exactly should I remind you about "${title}"?`);
        // A date with no time: only when the user really named none. A
        // clock time or "tonight" in the message means the model slipped.
        const allDay =
          t.all_day === true &&
          dueAt instanceof Date &&
          t.in_minutes === null &&
          !MENTIONS_CLOCK_TIME.test(ctx.text) &&
          !MENTIONS_TIME_OF_DAY.test(ctx.text);
        if (allDay && dueAt instanceof Date)
          dueAt = allDayFireTime(dueAt, ctx.timezone);
        const recurrence = dueAt
          ? toRecurrence(t.recurrence, ctx.timezone)
          : null;
        let firstAt = dueAt;
        if (firstAt && recurrence) {
          // Models often anchor a series on "today" even when today is not a
          // listed weekday or the time has passed; start it correctly.
          firstAt = alignFirstOccurrence(
            firstAt,
            recurrence,
            ctx.now,
            ctx.timezone,
          );
        } else if (
          firstAt &&
          (allDay
            ? // An all-day task is only late once its whole day is over.
              dayBoundsInZone(firstAt, ctx.timezone).end.getTime() <=
              ctx.now.getTime()
            : firstAt.getTime() < ctx.now.getTime() - PAST_TOLERANCE_MS)
        ) {
          return ask(
            `"${capitalise(title)}": that time has already passed. When should I remind you?`,
            pastTimeOptions(firstAt, ctx),
          );
        }
        tasks.push({
          title: capitalise(title),
          dueAt: firstAt,
          recurrence,
          priority: t.priority,
          categoryName: matchCategory(t.category, ctx.categories),
          leadMinutes:
            dueAt &&
            t.lead_minutes !== null &&
            t.lead_minutes > 0 &&
            t.lead_minutes <= 10080
              ? t.lead_minutes
              : null,
          notes: t.notes?.trim() ? t.notes.trim() : null,
          allDay,
        });
      }
      if (tasks.length === 0) return FALLBACK_QUESTION;
      // The user named a clock time and the model dropped it: a reminder
      // silently filed in the Inbox never fires. Ask instead.
      if (
        tasks.every((t) => t.dueAt === null) &&
        MENTIONS_CLOCK_TIME.test(ctx.text) &&
        !WANTS_NO_DATE.test(ctx.text)
      ) {
        return ask(
          tasks.length === 1
            ? `When should I remind you about "${tasks[0]!.title}"?`
            : 'When should I remind you about these?',
        );
      }
      return { intent: 'create', tasks };
    }
    case 'query':
      return {
        intent: 'query',
        range: out.query_range ?? 'today',
        search: out.query_search?.trim() ? out.query_search.trim() : null,
      };
    case 'complete':
      return targetIds.length > 0
        ? { intent: 'complete', targetIds }
        : ask('Which task did you finish?');
    case 'delete':
      return targetIds.length > 0
        ? { intent: 'delete', targetIds }
        : ask('Which task should I delete?');
    case 'reschedule': {
      if (targetIds.length === 0) return ask('Which task should I move?');
      // Models sometimes restate the task in `tasks` with its new time
      // instead of using the top-level field; accept that shape too.
      let dueAt = toInstant(
        out.due_local ?? restated?.due_local ?? null,
        out.in_minutes ?? restated?.in_minutes ?? null,
      );
      if (dueAt === 'invalid') return ask('To when should I move it?');
      if (dueAt) dueAt = alignToNamedWeekday(dueAt, ctx.text, ctx.timezone);
      const shift =
        out.shift_minutes !== null && out.shift_minutes !== 0
          ? out.shift_minutes
          : null;
      if (dueAt === null && shift === null)
        return ask('To when should I move it?');
      return {
        intent: 'reschedule',
        targetIds,
        dueAt,
        shiftMinutes: dueAt ? null : shift,
      };
    }
    case 'edit': {
      const [targetId] = targetIds;
      const currentTitle =
        ctx.candidates.find((c) => c.id === targetId)?.title ?? '';
      // Same tolerance as reschedule: a restated task carries the new values.
      const restatedTitle =
        restated &&
        restated.title.trim().toLowerCase() !==
          currentTitle.trim().toLowerCase()
          ? restated.title
          : null;
      const rawTitle = out.new_title ?? restatedTitle;
      const rawNotes = out.new_notes ?? restated?.notes ?? null;
      const title = rawTitle?.trim() ? capitalise(rawTitle.trim()) : null;
      const notes = rawNotes?.trim() ? rawNotes.trim() : null;
      if (!targetId) return ask('Which task should I change?');
      if (title === null && notes === null)
        return ask('What should I change it to?');
      return { intent: 'edit', targetId, title, notes };
    }
    case 'chat':
      return { intent: 'chat', reply: out.reply?.trim() || '🙂' };
    case 'unclear':
      return {
        intent: 'unclear',
        question: out.question?.trim() || FALLBACK_TEXT,
        options: out.options
          .map((o) => o.trim())
          .filter(Boolean)
          .slice(0, 4),
      };
  }
}

const PAST_TOLERANCE_MS = 60 * 1000;

/** "at 5", "17:00", "5pm", "в 5", "soat 5": the message names a clock time. */
const MENTIONS_CLOCK_TIME =
  /\b(at|by|@)\s*\d{1,2}\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*[ap]\.?m\b|(^|\s)(в|к)\s*\d{1,2}(\s|$|[:.,])|soat\s*\d{1,2}/iu;
const WANTS_NO_DATE =
  /\b(no|without)(\s+(a|an|any))?\s+(date|time)\b|без\s*(даты|времени)|sanasiz/iu;
/** "tonight", "in the morning", "утром", "kechqurun": a time of day was named. */
const MENTIONS_TIME_OF_DAY =
  /\b(morning|noon|midday|lunch(time)?|afternoon|evening|tonight|night|midnight)\b|утр[ао]м?|днём|днем|полдень|обед|вечер\p{L}*|ноч\p{L}*|ertalab|tushlik|kechqurun|kech(asi|a)|tun\p{L}*/iu;

/** Weekday names by date-fns day number (0 = Sunday): English, Russian, Uzbek. */
const WEEKDAY_NAMES: RegExp[] = [
  /^(sunday|воскресень\p{L}*|yakshanba\p{L}*)$/iu,
  /^(monday|понедельник\p{L}*|dushanba\p{L}*)$/iu,
  /^(tuesday|вторник\p{L}*|seshanba\p{L}*)$/iu,
  /^(wednesday|сред[ауые]|chorshanba\p{L}*)$/iu,
  /^(thursday|четверг\p{L}*|payshanba\p{L}*)$/iu,
  /^(friday|пятниц\p{L}*|juma\p{L}*)$/iu,
  /^(saturday|суббот\p{L}*|shanba\p{L}*)$/iu,
];

/**
 * Models miscount weekdays ("saturday" came back as a Thursday). When the
 * message names exactly one weekday and the date is on another, move it to
 * the first such weekday on or after the model's date, same time of day.
 */
function alignToNamedWeekday(date: Date, text: string, timezone: string): Date {
  const named = new Set<number>();
  for (const word of text.match(/\p{L}+/gu) ?? []) {
    const day = WEEKDAY_NAMES.findIndex((re) => re.test(word));
    if (day >= 0) named.add(day);
  }
  const [wanted] = [...named];
  if (named.size !== 1 || wanted === undefined) return date;
  const zoned = toZonedTime(date, timezone);
  const ahead = (wanted - getDay(zoned) + 7) % 7;
  return ahead === 0 ? date : fromZonedTime(addDays(zoned, ahead), timezone);
}

/** Titles that only restate "remind me" instead of naming something. */
const EMPTY_TITLE =
  /^(remind( me)?|reminder|notification|напомни(ть)?( мне)?|напоминание|eslat(ma)?)[.!]?$/iu;

function isSameLocalDay(a: Date, b: Date, timezone: string): boolean {
  const day = (d: Date): string => formatInTimeZone(d, timezone, 'yyyy-MM-dd');
  return day(a) === day(b);
}

/** One tap to the usual meaning of a time that just passed: the same time tomorrow. */
function pastTimeOptions(past: Date, ctx: InterpretContext): string[] {
  if (!isSameLocalDay(past, ctx.now, ctx.timezone)) return [];
  return [`Tomorrow ${formatInTimeZone(past, ctx.timezone, 'HH:mm')}`];
}

const BULK_WORDS =
  /\b(all|every|everything|each|both|today'?s|tomorrow'?s)\b|все|всё|всех|hammasi|barcha/iu;

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
}

function isGrounded(ctx: InterpretContext, targetIds: string[]): boolean {
  if (targetIds.some((id) => ctx.contextTaskIds.includes(id))) return true;
  if (BULK_WORDS.test(ctx.text)) return true;
  // A list number ("done with 2") counts when the user replied to a list;
  // that case is covered by contextTaskIds above.
  const said = new Set(words(ctx.text));
  return targetIds.every((id) => {
    const title = ctx.candidates.find((c) => c.id === id)?.title ?? '';
    // Prefix match tolerates inflection ("dentist's", "стоматологу").
    return words(title).some((w) =>
      [...said].some(
        (u) => u.startsWith(w.slice(0, 4)) || w.startsWith(u.slice(0, 4)),
      ),
    );
  });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The first occurrence of a series must be in the future and, for "every
 * Mon and Thu", on a listed weekday. Keeps the time of day.
 */
function alignFirstOccurrence(
  dueAt: Date,
  recurrence: Omit<Recurrence, 'anchorAt'>,
  now: Date,
  timezone: string,
): Date {
  let first = dueAt;
  if (recurrence.type === 'weekly' && recurrence.byWeekday?.length) {
    for (let i = 0; i < 7; i++) {
      const zoned = toZonedTime(first, timezone);
      if (recurrence.byWeekday.includes(getDay(zoned))) break;
      first = fromZonedTime(addDays(zoned, 1), timezone);
    }
  }
  if (recurrence.type === 'weekdays') {
    for (let i = 0; i < 2; i++) {
      const zoned = toZonedTime(first, timezone);
      if (getDay(zoned) !== 0 && getDay(zoned) !== 6) break;
      first = fromZonedTime(addDays(zoned, 1), timezone);
    }
  }
  if (first.getTime() > now.getTime()) return first;
  // Ignore `until` / `count` here: a series that starts late still starts.
  const { until: _until, count: _count, ...open } = recurrence;
  return (
    computeNextOccurrence(first, { ...open, anchorAt: first }, now, timezone) ??
    first
  );
}

function toRecurrence(
  r: AssistantModelOutput['tasks'][number]['recurrence'],
  timezone: string,
): Omit<Recurrence, 'anchorAt'> | null {
  if (!r) return null;
  const recurrence: Omit<Recurrence, 'anchorAt'> = { type: r.type };
  if (r.type === 'every_n_days') {
    recurrence.intervalDays =
      r.interval_days && r.interval_days >= 1 ? r.interval_days : 1;
  }
  if (
    ['weekly', 'monthly', 'yearly'].includes(r.type) &&
    r.interval &&
    r.interval > 1 &&
    r.interval <= 52
  ) {
    recurrence.interval = r.interval;
  }
  if (r.type === 'weekly' && r.by_weekday) {
    const days = [...new Set(r.by_weekday.filter((d) => d >= 0 && d <= 6))];
    if (days.length > 0) recurrence.byWeekday = days;
  }
  if (r.type === 'monthly' && r.last_day_of_month)
    recurrence.lastDayOfMonth = true;
  if (r.until_local) {
    const until = fromZonedTime(r.until_local, timezone);
    if (isValid(until)) recurrence.until = until;
  }
  if (
    r.count !== null &&
    Number.isInteger(r.count) &&
    r.count >= 1 &&
    r.count <= MAX_RECURRENCE_COUNT
  ) {
    recurrence.count = r.count;
  }
  return recurrence;
}

function matchCategory(
  name: string | null,
  categories: string[],
): string | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  return categories.find((c) => c.toLowerCase() === wanted) ?? null;
}
