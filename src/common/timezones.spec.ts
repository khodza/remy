import { canonicalTimeZone, cityOfTimeZone } from './timezones';

describe('canonicalTimeZone', () => {
  it('accepts real zones in any case and with spaces, and spells them canonically', () => {
    expect(canonicalTimeZone('europe/berlin')).toBe('Europe/Berlin');
    expect(canonicalTimeZone(' Asia/Tashkent ')).toBe('Asia/Tashkent');
    expect(canonicalTimeZone('America/New York')).toBe('America/New_York');
    expect(canonicalTimeZone('utc')).toBe('UTC');
    expect(canonicalTimeZone('GMT')).toBe('UTC');
  });

  it('rejects cities, offsets and nonsense', () => {
    for (const bad of ['Berlin', '+05:00', 'Europe/Atlantis', '', null]) {
      expect(canonicalTimeZone(bad)).toBeNull();
    }
  });
});

describe('cityOfTimeZone', () => {
  it('is the last segment with spaces', () => {
    expect(cityOfTimeZone('Asia/Tashkent')).toBe('Tashkent');
    expect(cityOfTimeZone('America/Argentina/Buenos_Aires')).toBe(
      'Buenos Aires',
    );
    expect(cityOfTimeZone('UTC')).toBe('UTC');
  });
});
