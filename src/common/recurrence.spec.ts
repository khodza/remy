import {
  computeLatestOccurrence,
  computeNextOccurrence,
  describeRecurrence,
} from './recurrence';

describe('describeRecurrence', () => {
  it('returns null for one-shot tasks', () => {
    expect(describeRecurrence(null)).toBeNull();
    expect(describeRecurrence(undefined)).toBeNull();
  });

  it('labels each recurrence type', () => {
    expect(describeRecurrence({ type: 'daily' })).toBe('every day');
    expect(describeRecurrence({ type: 'weekdays' })).toBe('every weekday');
    expect(describeRecurrence({ type: 'weekly' })).toBe('every week');
    expect(describeRecurrence({ type: 'monthly' })).toBe('every month');
    expect(describeRecurrence({ type: 'every_n_days', intervalDays: 3 })).toBe(
      'every 3 days',
    );
  });

  it('collapses every_n_days with interval 1 (or missing) to every day', () => {
    expect(describeRecurrence({ type: 'every_n_days', intervalDays: 1 })).toBe(
      'every day',
    );
    expect(describeRecurrence({ type: 'every_n_days' })).toBe('every day');
  });
});

describe('computeNextOccurrence', () => {
  const base = new Date('2026-09-16T09:00:00Z'); // Wednesday

  it('advances one step when the next step is already in the future', () => {
    const now = new Date('2026-09-16T10:00:00Z');
    expect(computeNextOccurrence(base, { type: 'daily' }, now)).toEqual(
      new Date('2026-09-17T09:00:00Z'),
    );
    expect(computeNextOccurrence(base, { type: 'weekly' }, now)).toEqual(
      new Date('2026-09-23T09:00:00Z'),
    );
    expect(
      computeNextOccurrence(
        base,
        { type: 'every_n_days', intervalDays: 3 },
        now,
      ),
    ).toEqual(new Date('2026-09-19T09:00:00Z'));
  });

  it('skips weekends for weekdays', () => {
    const friday = new Date('2026-09-18T09:00:00Z');
    const now = new Date('2026-09-18T10:00:00Z');
    expect(computeNextOccurrence(friday, { type: 'weekdays' }, now)).toEqual(
      new Date('2026-09-21T09:00:00Z'), // Monday
    );
  });

  it('catches up past now when many cycles were missed', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    expect(computeNextOccurrence(base, { type: 'daily' }, now)).toEqual(
      new Date('2026-09-27T09:00:00Z'),
    );
  });

  it('monthly: keeps the anchor day after a short month (B4)', () => {
    const jan31 = new Date('2026-01-31T09:00:00Z');
    const monthly = { type: 'monthly' as const, anchorAt: jan31 };
    const feb = computeNextOccurrence(
      jan31,
      monthly,
      new Date('2026-01-31T10:00:00Z'),
    );
    expect(feb).toEqual(new Date('2026-02-28T09:00:00Z'));
    const mar = computeNextOccurrence(feb, monthly, feb);
    expect(mar).toEqual(new Date('2026-03-31T09:00:00Z'));
    const apr = computeNextOccurrence(mar, monthly, mar);
    expect(apr).toEqual(new Date('2026-04-30T09:00:00Z'));
  });

  it('monthly without an anchor falls back to the current day (legacy tasks)', () => {
    const jan31 = new Date('2026-01-31T09:00:00Z');
    const feb = computeNextOccurrence(
      jan31,
      { type: 'monthly' },
      new Date('2026-01-31T10:00:00Z'),
    );
    expect(feb).toEqual(new Date('2026-02-28T09:00:00Z'));
  });

  describe('in a timezone with DST', () => {
    // Europe/Berlin: 2026-03-29 02:00 CET → 03:00 CEST.
    it('daily keeps 09:00 local across the switch (B3)', () => {
      const before = new Date('2026-03-28T08:00:00Z'); // 09:00 CET
      const next = computeNextOccurrence(
        before,
        { type: 'daily' },
        before,
        'Europe/Berlin',
      );
      expect(next).toEqual(new Date('2026-03-29T07:00:00Z')); // 09:00 CEST
    });

    it('weekly keeps the local time too', () => {
      const before = new Date('2026-03-25T08:00:00Z'); // Wed 09:00 CET
      const next = computeNextOccurrence(
        before,
        { type: 'weekly' },
        before,
        'Europe/Berlin',
      );
      expect(next).toEqual(new Date('2026-04-01T07:00:00Z')); // Wed 09:00 CEST
    });

    it('weekdays are judged on the local calendar, not UTC', () => {
      // Fri 2026-09-18 23:30 in Tashkent (UTC+5) is Fri 18:30Z; "next weekday" is Mon.
      const fridayLate = new Date('2026-09-18T18:30:00Z');
      const next = computeNextOccurrence(
        fridayLate,
        { type: 'weekdays' },
        fridayLate,
        'Asia/Tashkent',
      );
      expect(next).toEqual(new Date('2026-09-21T18:30:00Z'));
    });
  });
});

describe('computeLatestOccurrence', () => {
  const base = new Date('2026-09-16T09:00:00Z');

  it('returns the input while the next occurrence is still in the future', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    expect(computeLatestOccurrence(base, { type: 'daily' }, now)).toEqual(base);
  });

  it('returns the newest occurrence at or before now', () => {
    const now = new Date('2026-09-19T12:00:00Z');
    expect(computeLatestOccurrence(base, { type: 'daily' }, now)).toEqual(
      new Date('2026-09-19T09:00:00Z'),
    );
  });

  it('lands exactly on now when an occurrence coincides with it', () => {
    const now = new Date('2026-09-19T09:00:00Z');
    expect(computeLatestOccurrence(base, { type: 'daily' }, now)).toEqual(now);
  });
});
