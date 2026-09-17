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
    expect(
      describeRecurrence({ type: 'every_n_days', intervalDays: 3 }),
    ).toBe('every 3 days');
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
      computeNextOccurrence(base, { type: 'every_n_days', intervalDays: 3 }, now),
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

  it('monthly: known limitation — a 31st clamps and never returns (B4)', () => {
    const jan31 = new Date('2026-01-31T09:00:00Z');
    const now = new Date('2026-01-31T10:00:00Z');
    const feb = computeNextOccurrence(jan31, { type: 'monthly' }, now);
    expect(feb).toEqual(new Date('2026-02-28T09:00:00Z'));
    // Documents the current drift so the Phase 1 fix has a failing test to flip.
    const mar = computeNextOccurrence(feb, { type: 'monthly' }, feb);
    expect(mar).toEqual(new Date('2026-03-28T09:00:00Z'));
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
