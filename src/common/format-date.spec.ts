import { formatForUser, formatForUserShort, zoneHint } from './format-date';

const at = new Date('2026-09-21T07:00:00Z'); // 09:00 Berlin, 12:00 Tashkent

describe('formatForUser', () => {
  it('formats in the given zone, 24-hour; all-day as a date only', () => {
    expect(formatForUser(at, 'Asia/Tashkent')).toBe('Mon 21 Sep 2026, 12:00');
    expect(formatForUser(at, 'Asia/Tashkent', true)).toBe(
      'Mon 21 Sep 2026 (all day)',
    );
    expect(formatForUserShort(at, 'Europe/Berlin')).toBe('Mon 21 Sep, 09:00');
  });
});

describe('zoneHint', () => {
  it('names the task clock only when it differs from the user clock', () => {
    expect(zoneHint(at, 'Europe/Berlin', 'Asia/Tashkent')).toBe(
      ' <i>(09:00 Berlin time)</i>',
    );
    expect(zoneHint(at, 'America/Argentina/Buenos_Aires', 'UTC')).toBe(
      ' <i>(04:00 Buenos Aires time)</i>',
    );
    expect(zoneHint(at, 'Europe/Berlin', 'Europe/Berlin')).toBe('');
    expect(zoneHint(at, 'Europe/Berlin', 'Europe/Paris')).toBe('');
    expect(zoneHint(at, 'Europe/Berlin', 'Asia/Tashkent', true)).toBe('');
  });
});
