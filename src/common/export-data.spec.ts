import { TaskStatus } from '@domain/task';
import { DEFAULT_USER_SETTINGS } from '@domain/user';
import { makeTask } from '@test/factories';
import {
  buildCsvExport,
  buildJsonExport,
  csvCell,
  exportFilename,
} from './export-data';

const NOW = new Date('2026-09-19T19:30:00Z'); // 00:30 on the 20th in Tashkent
const categories = [
  { id: 'c1', name: 'Health', emoji: '🩺', color: '#F04438', keywords: [] },
];
const tasks = [
  makeTask({
    id: 't1',
    description: 'Dentist, then "pharmacy"',
    scheduledAt: new Date('2026-09-20T05:00:00Z'),
    timezone: 'Asia/Tashkent',
    categoryId: 'c1',
    notes: 'Bring the card\nand cash',
  }),
  makeTask({
    id: 't2',
    description: '=HYPERLINK("x")',
    scheduledAt: null,
    status: TaskStatus.Completed,
    completedAt: new Date('2026-09-18T12:00:00Z'),
    recurrence: null,
  }),
  makeTask({
    id: 't3',
    description: 'Позвонить маме',
    scheduledAt: new Date('2026-09-21T14:00:00Z'),
    recurrence: {
      type: 'weekly',
      byWeekday: [1, 4],
      anchorAt: new Date('2026-09-21T14:00:00Z'),
    },
  }),
];
const input = {
  timezone: 'Asia/Tashkent',
  settings: DEFAULT_USER_SETTINGS,
  categories,
  tasks,
  now: NOW,
};

describe('export files', () => {
  it('JSON keeps the full record with ISO dates and category names', () => {
    const body = JSON.parse(buildJsonExport(input));
    expect(body).toMatchObject({
      app: 'remy',
      version: 1,
      timezone: 'Asia/Tashkent',
    });
    expect(body.tasks).toHaveLength(3);
    expect(body.tasks[0]).toMatchObject({
      id: 't1',
      dueAt: '2026-09-20T05:00:00.000Z',
      category: 'Health',
      notes: 'Bring the card\nand cash',
    });
    // Internal anchor stays internal.
    expect(body.tasks[2].recurrence).toEqual({
      type: 'weekly',
      byWeekday: [1, 4],
    });
  });

  it('CSV quotes, escapes, neutralises formulas and writes local times', () => {
    const csv = buildCsvExport(input);
    expect(csv.startsWith('﻿title,status,due,')).toBe(true);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[1]).toBe(
      '"Dentist, then ""pharmacy""",pending,2026-09-20 10:00,Asia/Tashkent,,Health,normal,"Bring the card\nand cash",2026-04-15 15:00,,t1',
    );
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[3]).toContain('Позвонить маме');
    expect(lines[3]).toContain('Every Mon and Thu');
  });

  it('neutralises formula-looking cells and names the file by local date', () => {
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(exportFilename('csv', NOW, 'Asia/Tashkent')).toBe(
      'remy-2026-09-20.csv',
    );
  });
});
