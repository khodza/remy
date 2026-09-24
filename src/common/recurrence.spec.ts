import {
  computeLatestOccurrence,
  computeNextOccurrence,
  describeRecurrence,
  rolloverTimeOf,
  seriesEnd,
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

  it('a series more than 1000 cycles behind is ended, never a date in the past (B10)', () => {
    const now = new Date('2030-01-01T00:00:00Z'); // ~1200 days after base
    expect(computeNextOccurrence(base, { type: 'daily' }, now)).toBeNull();
    // Within the cap it still catches up normally.
    const soon = new Date('2028-01-01T00:00:00Z');
    expect(
      computeNextOccurrence(base, { type: 'daily' }, soon)!.getTime(),
    ).toBeGreaterThan(soon.getTime());
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
    const mar = computeNextOccurrence(feb!, monthly, feb!);
    expect(mar).toEqual(new Date('2026-03-31T09:00:00Z'));
    const apr = computeNextOccurrence(mar!, monthly, mar!);
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

describe('richer grammar', () => {
  const at = (iso: string) => new Date(iso);

  it('"every Mon and Thu" walks the listed weekdays', () => {
    const rule = { type: 'weekly' as const, byWeekday: [1, 4] };
    const mon = at('2026-09-14T07:00:00Z'); // Monday
    const thu = computeNextOccurrence(mon, rule, mon)!;
    expect(thu).toEqual(at('2026-09-17T07:00:00Z'));
    expect(computeNextOccurrence(thu, rule, thu)).toEqual(
      at('2026-09-21T07:00:00Z'),
    );
  });

  it('"every 2 weeks on Mon and Thu" skips the off week, counted from the anchor', () => {
    const mon = at('2026-09-14T07:00:00Z');
    const rule = {
      type: 'weekly' as const,
      interval: 2,
      byWeekday: [1, 4],
      anchorAt: mon,
    };
    const thu = computeNextOccurrence(mon, rule, mon)!;
    expect(thu).toEqual(at('2026-09-17T07:00:00Z'));
    expect(computeNextOccurrence(thu, rule, thu)).toEqual(
      at('2026-09-28T07:00:00Z'),
    );
  });

  it('"every 2 weeks" without weekdays', () => {
    const d = at('2026-09-14T07:00:00Z');
    expect(
      computeNextOccurrence(d, { type: 'weekly', interval: 2 }, d),
    ).toEqual(at('2026-09-28T07:00:00Z'));
  });

  it('"last day of every month"', () => {
    const rule = { type: 'monthly' as const, lastDayOfMonth: true };
    const jan = at('2026-01-31T09:00:00Z');
    const feb = computeNextOccurrence(jan, rule, jan)!;
    expect(feb).toEqual(at('2026-02-28T09:00:00Z'));
    expect(computeNextOccurrence(feb, rule, feb)).toEqual(
      at('2026-03-31T09:00:00Z'),
    );
  });

  it('"every 3 months" keeps the anchor day', () => {
    const d = at('2026-01-31T09:00:00Z');
    expect(
      computeNextOccurrence(
        d,
        { type: 'monthly', interval: 3, anchorAt: d },
        d,
      ),
    ).toEqual(at('2026-04-30T09:00:00Z'));
  });

  it('yearly: a 29 Feb birthday falls on 28 Feb in common years and returns', () => {
    const leap = at('2028-02-29T09:00:00Z');
    const rule = { type: 'yearly' as const, anchorAt: leap };
    const y1 = computeNextOccurrence(leap, rule, leap)!;
    expect(y1).toEqual(at('2029-02-28T09:00:00Z'));
    const y4 = [1, 2, 3].reduce((d) => computeNextOccurrence(d, rule, d)!, y1);
    expect(y4).toEqual(at('2032-02-29T09:00:00Z'));
  });

  it('until: returns null once the next occurrence would pass the end', () => {
    const d = at('2026-09-16T09:00:00Z');
    const rule = { type: 'daily' as const, until: at('2026-09-17T23:59:59Z') };
    const next = computeNextOccurrence(d, rule, d)!;
    expect(next).toEqual(at('2026-09-17T09:00:00Z'));
    expect(computeNextOccurrence(next, rule, next)).toBeNull();
    // Rolling over an ignored task never goes past the end either.
    expect(
      computeLatestOccurrence(d, rule, at('2026-09-30T00:00:00Z')),
    ).toEqual(next);
  });

  it('describes the new shapes', () => {
    expect(describeRecurrence({ type: 'weekly', byWeekday: [4, 1] })).toBe(
      'every Mon and Thu',
    );
    expect(describeRecurrence({ type: 'weekly', byWeekday: [6, 0] })).toBe(
      'every Sat and Sun',
    );
    expect(describeRecurrence({ type: 'weekly', interval: 2 })).toBe(
      'every 2 weeks',
    );
    expect(
      describeRecurrence({ type: 'weekly', interval: 2, byWeekday: [1] }),
    ).toBe('every 2 weeks on Mon');
    expect(describeRecurrence({ type: 'monthly', lastDayOfMonth: true })).toBe(
      'on the last day of every month',
    );
    expect(describeRecurrence({ type: 'yearly' })).toBe('every year');
    expect(
      describeRecurrence(
        { type: 'daily', until: at('2026-12-31T18:59:00Z') },
        'Asia/Tashkent',
      ),
    ).toBe('every day until 31 Dec 2026');
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

describe('rolloverTimeOf', () => {
  const at = new Date('2026-09-16T09:00:00Z');

  it('is the next cycle after the current occurrence, in the task zone', () => {
    expect(rolloverTimeOf(at, { type: 'daily' })).toEqual(
      new Date('2026-09-17T09:00:00Z'),
    );
    expect(rolloverTimeOf(at, { type: 'weekly', byWeekday: [1] })).toEqual(
      new Date('2026-09-21T09:00:00Z'), // Monday
    );
  });

  it('is null on the last occurrence of a series', () => {
    expect(
      rolloverTimeOf(at, { type: 'daily', count: 1, anchorAt: at }),
    ).toBeNull();
    expect(
      rolloverTimeOf(at, {
        type: 'daily',
        until: new Date('2026-09-16T23:59:59Z'),
      }),
    ).toBeNull();
    expect(
      rolloverTimeOf(at, {
        type: 'daily',
        until: new Date('2026-09-17T23:59:59Z'),
      }),
    ).toEqual(new Date('2026-09-17T09:00:00Z'));
  });
});

describe('count ("× N times")', () => {
  const at = (iso: string) => new Date(iso);

  it('ends the series after N occurrences counted from the anchor', () => {
    const first = at('2026-09-16T09:00:00Z');
    const rule = { type: 'daily' as const, count: 3, anchorAt: first };
    const second = computeNextOccurrence(first, rule, first)!;
    const third = computeNextOccurrence(second, rule, second)!;
    expect([second, third]).toEqual([
      at('2026-09-17T09:00:00Z'),
      at('2026-09-18T09:00:00Z'),
    ]);
    expect(computeNextOccurrence(third, rule, third)).toBeNull();
    expect(seriesEnd(rule)).toEqual(third);
  });

  it('count 1 is a series with a single occurrence', () => {
    const first = at('2026-09-16T09:00:00Z');
    const rule = { type: 'weekly' as const, count: 1, anchorAt: first };
    expect(computeNextOccurrence(first, rule, first)).toBeNull();
  });

  it('catching up never runs past the last occurrence', () => {
    const first = at('2026-09-16T09:00:00Z');
    const rule = { type: 'daily' as const, count: 5, anchorAt: first };
    // Ignored for weeks: done/skip closes the series, rollover stops at #5.
    const late = at('2026-10-10T00:00:00Z');
    expect(computeNextOccurrence(first, rule, late)).toBeNull();
    expect(computeLatestOccurrence(first, rule, late)).toEqual(
      at('2026-09-20T09:00:00Z'),
    );
  });

  it('with until as well, whichever comes first ends it', () => {
    const first = at('2026-09-16T09:00:00Z');
    const early = {
      type: 'daily' as const,
      count: 10,
      until: at('2026-09-17T23:00:00Z'),
      anchorAt: first,
    };
    expect(seriesEnd(early)).toEqual(at('2026-09-17T23:00:00Z'));
    const late = { ...early, count: 2, until: at('2026-12-31T00:00:00Z') };
    expect(seriesEnd(late)).toEqual(at('2026-09-17T09:00:00Z'));
  });

  it('counts on the wall clock across a DST switch (Europe/Berlin, 25 Oct 2026)', () => {
    const tz = 'Europe/Berlin';
    // 09:00 CEST on Fri 23 Oct = 07:00Z; the clocks go back on Sun 25 Oct.
    const first = at('2026-10-23T07:00:00Z');
    const rule = { type: 'daily' as const, count: 4, anchorAt: first };
    // #4 is Mon 26 Oct 09:00 CET = 08:00Z.
    expect(seriesEnd(rule, tz)).toEqual(at('2026-10-26T08:00:00Z'));
    const fourth = computeLatestOccurrence(
      first,
      rule,
      at('2026-11-30T00:00:00Z'),
      tz,
    );
    expect(fourth).toEqual(at('2026-10-26T08:00:00Z'));
    expect(computeNextOccurrence(fourth, rule, fourth, tz)).toBeNull();
  });

  it('legacy tasks without an anchor count from the current occurrence', () => {
    const current = at('2026-09-16T09:00:00Z');
    const rule = { type: 'daily' as const, count: 2 };
    expect(computeNextOccurrence(current, rule, current)).toEqual(
      at('2026-09-17T09:00:00Z'),
    );
  });

  it('is described', () => {
    expect(describeRecurrence({ type: 'daily', count: 10 })).toBe(
      'every day × 10 times',
    );
    expect(describeRecurrence({ type: 'weekly', count: 1 })).toBe(
      'every week × 1 time',
    );
  });
});
