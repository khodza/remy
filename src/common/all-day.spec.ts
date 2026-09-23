import { allDayFireTime, isTaskOverdue } from './all-day';

describe('all-day tasks', () => {
  it('fire at 09:00 on the local date, whatever time was sent', () => {
    // 23:30 on 16 Apr in Tashkent (UTC+5) is still the 16th there.
    expect(
      allDayFireTime(new Date('2026-04-16T18:30:00Z'), 'Asia/Tashkent'),
    ).toEqual(new Date('2026-04-16T04:00:00Z'));
    // Local midnight of 17 Apr → 09:00 on the 17th.
    expect(
      allDayFireTime(new Date('2026-04-16T19:00:00Z'), 'Asia/Tashkent'),
    ).toEqual(new Date('2026-04-17T04:00:00Z'));
  });

  it('keep 09:00 local across a DST switch', () => {
    // Sun 25 Oct 2026, Berlin goes back to CET (UTC+1).
    expect(
      allDayFireTime(new Date('2026-10-25T12:00:00Z'), 'Europe/Berlin'),
    ).toEqual(new Date('2026-10-25T08:00:00Z'));
    expect(
      allDayFireTime(new Date('2026-10-24T12:00:00Z'), 'Europe/Berlin'),
    ).toEqual(new Date('2026-10-24T07:00:00Z'));
  });

  it('are overdue only after their day ends; timed tasks from their time', () => {
    const base = {
      status: 'pending',
      scheduledAt: new Date('2026-04-16T04:00:00Z'), // 09:00 Tashkent
      snoozedUntil: null,
      timezone: 'Asia/Tashkent',
    };
    const noonThere = new Date('2026-04-16T07:00:00Z');
    const nextDay = new Date('2026-04-16T19:00:00Z'); // 00:00 on the 17th
    expect(isTaskOverdue({ ...base, allDay: true }, noonThere)).toBe(false);
    expect(isTaskOverdue({ ...base, allDay: true }, nextDay)).toBe(true);
    expect(isTaskOverdue({ ...base, allDay: false }, noonThere)).toBe(true);
    expect(
      isTaskOverdue({ ...base, allDay: false, scheduledAt: null }, nextDay),
    ).toBe(false);
    expect(
      isTaskOverdue({ ...base, allDay: true, status: 'completed' }, nextDay),
    ).toBe(false);
  });
});
