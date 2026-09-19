import { deriveNextFireAt, effectiveDueAt, snoozePresets } from './fire-time';

const due = new Date('2026-09-18T12:00:00Z');

describe('deriveNextFireAt', () => {
  const base = {
    scheduledAt: due,
    snoozedUntil: null,
    leadMinutes: null,
    leadSentFor: null,
  };

  it('todos never fire', () => {
    expect(
      deriveNextFireAt({ ...base, scheduledAt: null, leadMinutes: 30 }),
    ).toBeNull();
  });

  it('fires at the due time without a lead', () => {
    expect(deriveNextFireAt(base)).toEqual(due);
  });

  it('fires the heads-up first, then the real reminder once it was sent', () => {
    expect(deriveNextFireAt({ ...base, leadMinutes: 30 })).toEqual(
      new Date('2026-09-18T11:30:00Z'),
    );
    expect(
      deriveNextFireAt({ ...base, leadMinutes: 30, leadSentFor: due }),
    ).toEqual(due);
  });

  it('a heads-up sent for an earlier occurrence does not count for the next one', () => {
    const nextDay = new Date('2026-09-19T12:00:00Z');
    expect(
      deriveNextFireAt({
        ...base,
        scheduledAt: nextDay,
        leadMinutes: 30,
        leadSentFor: due,
      }),
    ).toEqual(new Date('2026-09-19T11:30:00Z'));
  });

  it('a snooze wins over the lead', () => {
    const snooze = new Date('2026-09-18T13:00:00Z');
    expect(
      deriveNextFireAt({ ...base, leadMinutes: 30, snoozedUntil: snooze }),
    ).toEqual(snooze);
  });
});

describe('effectiveDueAt', () => {
  it('ignores the heads-up and honours the snooze', () => {
    expect(effectiveDueAt({ scheduledAt: due, snoozedUntil: null })).toEqual(
      due,
    );
    const snooze = new Date('2026-09-18T13:00:00Z');
    expect(effectiveDueAt({ scheduledAt: due, snoozedUntil: snooze })).toEqual(
      snooze,
    );
    expect(
      effectiveDueAt({ scheduledAt: null, snoozedUntil: null }),
    ).toBeNull();
  });
});

describe('snoozePresets', () => {
  it('offers tonight 20:00 and tomorrow 09:00 on the user wall clock', () => {
    // 14:47 in Tashkent (UTC+5)
    const presets = snoozePresets(
      new Date('2026-09-18T09:47:00Z'),
      'Asia/Tashkent',
    );
    expect(presets).toEqual([
      {
        key: 'tonight',
        label: 'Tonight',
        at: new Date('2026-09-18T15:00:00Z'),
      },
      {
        key: 'tomorrow',
        label: 'Tomorrow',
        at: new Date('2026-09-19T04:00:00Z'),
      },
    ]);
  });

  it('drops tonight when it is less than an hour away', () => {
    const presets = snoozePresets(
      new Date('2026-09-18T14:30:00Z'),
      'Asia/Tashkent',
    ); // 19:30 local
    expect(presets.map((p) => p.key)).toEqual(['tomorrow']);
  });
});

describe('deriveNextFireAt with nudges', () => {
  const nudgeAt = new Date('2026-09-18T12:30:00Z');
  it('a pending nudge comes before the (already sent) due time and a snooze', () => {
    expect(
      deriveNextFireAt({
        scheduledAt: due,
        snoozedUntil: null,
        leadMinutes: 30,
        leadSentFor: due,
        nudgeAt,
      }),
    ).toEqual(nudgeAt);
    expect(
      deriveNextFireAt({
        scheduledAt: due,
        snoozedUntil: new Date('2026-09-18T12:10:00Z'),
        leadMinutes: null,
        leadSentFor: null,
        nudgeAt,
      }),
    ).toEqual(nudgeAt);
  });
  it('todos ignore nudges', () => {
    expect(
      deriveNextFireAt({
        scheduledAt: null,
        snoozedUntil: null,
        leadMinutes: null,
        leadSentFor: null,
        nudgeAt,
      }),
    ).toBeNull();
  });
});
