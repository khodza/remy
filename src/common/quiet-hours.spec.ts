import { isInQuietHours, quietHoursEnd } from './quiet-hours';

const night = { enabled: true, from: '23:00', to: '07:00' };
const tz = 'Asia/Tashkent'; // UTC+5
const at = (localHHmm: string, day = '2026-09-18') => {
  const [h, m] = localHHmm.split(':').map(Number);
  return new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
      h! - 5,
      m!,
    ),
  );
};

describe('quiet hours', () => {
  it.each([
    ['22:59', false],
    ['23:00', true],
    ['02:30', true],
    ['06:59', true],
    ['07:00', false],
    ['14:47', false],
  ])('a window that wraps midnight: %s → %s', (time, expected) => {
    expect(isInQuietHours(at(time), tz, night)).toBe(expected);
  });

  it('a daytime window does not wrap', () => {
    const lunch = { enabled: true, from: '13:00', to: '14:00' };
    expect(isInQuietHours(at('13:30'), tz, lunch)).toBe(true);
    expect(isInQuietHours(at('02:00'), tz, lunch)).toBe(false);
  });

  it('disabled or empty windows never mute', () => {
    expect(isInQuietHours(at('02:00'), tz, { ...night, enabled: false })).toBe(
      false,
    );
    expect(
      isInQuietHours(at('02:00'), tz, {
        enabled: true,
        from: '07:00',
        to: '07:00',
      }),
    ).toBe(false);
  });

  it('ends at the next local "to" time: same morning after midnight, next morning before', () => {
    expect(quietHoursEnd(at('02:30', '2026-09-19'), tz, night)).toEqual(
      at('07:00', '2026-09-19'),
    );
    expect(quietHoursEnd(at('23:30', '2026-09-18'), tz, night)).toEqual(
      at('07:00', '2026-09-19'),
    );
  });

  it('respects DST: 07:00 Berlin is 05:00Z after the switch', () => {
    // Night of 28→29 March 2026, clocks go forward at 02:00.
    const end = quietHoursEnd(
      new Date('2026-03-28T23:30:00Z'),
      'Europe/Berlin',
      night,
    );
    expect(end).toEqual(new Date('2026-03-29T05:00:00Z'));
  });
});
