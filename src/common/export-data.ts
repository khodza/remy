import { formatInTimeZone } from 'date-fns-tz';
import type { Recurrence, Task } from '@domain/task';
import type { Category, UserSettings } from '@domain/user';
import { describeRecurrence } from './recurrence';

/**
 * The "download everything" files. Pure: the use case passes the data.
 * JSON is the full record (re-importable later); CSV is for spreadsheets.
 */
export type ExportInput = {
  timezone: string;
  settings: UserSettings;
  categories: Category[];
  tasks: Task[];
  now: Date;
};

export const EXPORT_FORMAT_VERSION = 1;

const iso = (date: Date | null | undefined) =>
  date ? date.toISOString() : null;

function recurrenceJson(recurrence: Recurrence | null) {
  if (!recurrence) return null;
  const { anchorAt: _anchor, until, ...rest } = recurrence;
  return { ...rest, ...(until ? { until: until.toISOString() } : {}) };
}

export function buildJsonExport(input: ExportInput): string {
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const body = {
    app: 'remy',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: input.now.toISOString(),
    timezone: input.timezone,
    settings: input.settings,
    categories: input.categories,
    tasks: input.tasks.map((task) => ({
      id: task.id,
      title: task.description,
      notes: task.notes,
      status: task.status,
      /** When it is due for the user (a snooze included). */
      dueAt: iso(task.snoozedUntil ?? task.scheduledAt),
      scheduledAt: iso(task.scheduledAt),
      timezone: task.timezone,
      recurrence: recurrenceJson(task.recurrence),
      priority: task.priority,
      category: task.categoryId ? (names.get(task.categoryId) ?? null) : null,
      leadMinutes: task.leadMinutes,
      source: {
        type: task.source.type,
        originalText: task.source.originalText,
        forwardedFrom: task.source.forwardedFrom,
      },
      completedAt: iso(task.completedAt),
      completions: task.completions.map((c) => ({
        at: c.at.toISOString(),
        occurrenceAt: c.occurrenceAt.toISOString(),
      })),
      snoozeCount: task.snoozeCount,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

const CSV_COLUMNS = [
  'title',
  'status',
  'due',
  'timezone',
  'repeat',
  'category',
  'priority',
  'notes',
  'created',
  'completed',
  'id',
] as const;

/**
 * One cell: quoted when needed, and a leading = + - @ is neutralised so a
 * spreadsheet never runs a title as a formula.
 */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsvExport(input: ExportInput): string {
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const local = (date: Date | null, tz: string) =>
    date ? formatInTimeZone(date, tz, 'yyyy-MM-dd HH:mm') : '';
  const rows = input.tasks.map((task) => {
    const cells: Record<(typeof CSV_COLUMNS)[number], string | null> = {
      title: task.description,
      status: task.status,
      due: local(task.snoozedUntil ?? task.scheduledAt, task.timezone),
      timezone: task.timezone,
      repeat: capitalise(describeRecurrence(task.recurrence, task.timezone)),
      category: task.categoryId ? (names.get(task.categoryId) ?? null) : null,
      priority: task.priority,
      notes: task.notes,
      created: local(task.createdAt, task.timezone),
      completed: local(task.completedAt, task.timezone),
      id: task.id,
    };
    return CSV_COLUMNS.map((column) => csvCell(cells[column])).join(',');
  });
  // The BOM makes Excel read UTF-8 (Cyrillic, emoji) correctly.
  return `﻿${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`;
}

/** The bot's wording is lowercase ("every Mon and Thu"); a column starts with a capital. */
function capitalise(text: string | null): string | null {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "remy-2026-09-19.csv" in the user's local date. */
export function exportFilename(
  format: 'csv' | 'json',
  now: Date,
  tz: string,
): string {
  return `remy-${formatInTimeZone(now, tz, 'yyyy-MM-dd')}.${format}`;
}
