import { interpretModelOutput } from './gateway';

describe('interpretModelOutput', () => {
  it('converts local wall-clock time in the user zone to an instant', () => {
    const out = interpretModelOutput(
      {
        description: 'Call mom',
        scheduledAtLocal: '2026-09-18T17:00:00',
        recurrence: null,
      },
      'Asia/Tashkent', // UTC+5, no DST
    );
    expect(out.scheduledAt).toEqual(new Date('2026-09-18T12:00:00Z'));
    expect(out.recurrence).toBeNull();
  });

  it('applies the offset in force on that date, not today (B2)', () => {
    // Berlin is UTC+1 in January and UTC+2 in July.
    const jan = interpretModelOutput(
      { description: 'x', scheduledAtLocal: '2026-01-15T09:00:00' },
      'Europe/Berlin',
    );
    const jul = interpretModelOutput(
      { description: 'x', scheduledAtLocal: '2026-07-15T09:00:00' },
      'Europe/Berlin',
    );
    expect(jan.scheduledAt).toEqual(new Date('2026-01-15T08:00:00Z'));
    expect(jul.scheduledAt).toEqual(new Date('2026-07-15T07:00:00Z'));
  });

  it('still accepts the legacy scheduledAt-with-offset shape', () => {
    const out = interpretModelOutput(
      { description: 'x', scheduledAt: '2026-09-18T17:00:00+05:00' },
      'Asia/Tashkent',
    );
    expect(out.scheduledAt).toEqual(new Date('2026-09-18T12:00:00Z'));
  });

  it('normalises recurrence and defaults every_n_days interval to 1', () => {
    expect(
      interpretModelOutput(
        {
          description: 'x',
          scheduledAtLocal: '2026-09-18T09:00:00',
          recurrence: { type: 'every_n_days' },
        },
        'UTC',
      ).recurrence,
    ).toEqual({ type: 'every_n_days', intervalDays: 1 });
    expect(
      interpretModelOutput(
        {
          description: 'x',
          scheduledAtLocal: '2026-09-18T09:00:00',
          recurrence: { type: 'daily', intervalDays: 3 },
        },
        'UTC',
      ).recurrence,
    ).toEqual({ type: 'daily' });
    expect(
      interpretModelOutput(
        {
          description: 'x',
          scheduledAtLocal: '2026-09-18T09:00:00',
          recurrence: { type: 'bogus' },
        },
        'UTC',
      ).recurrence,
    ).toBeNull();
  });

  it.each([
    [{ scheduledAtLocal: '2026-09-18T09:00:00' }, /no description/],
    [{ description: 'x' }, /no scheduledAtLocal/],
    [
      { description: 'x', scheduledAtLocal: 'next tuesday-ish' },
      /invalid time/,
    ],
    ['not an object', /not an object/],
  ])('rejects malformed output %p', (raw, message) => {
    expect(() => interpretModelOutput(raw, 'UTC')).toThrow(message);
  });
});
