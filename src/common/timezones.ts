/**
 * IANA zone names the runtime knows, for turning what the user typed
 * ("europe/berlin", "Asia/Tashkent", "utc") into the canonical spelling.
 * The same Intl engine date-fns-tz formats with, so anything accepted here
 * formats correctly later.
 */
const KNOWN = new Map<string, string>(
  [...Intl.supportedValuesOf('timeZone'), 'UTC'].map((z) => [
    z.toLowerCase(),
    z,
  ]),
);

/** The canonical IANA name for `raw`, or null when it is not a zone. */
export function canonicalTimeZone(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const key = raw.trim().replace(/\s+/g, '_').toLowerCase();
  if (key === 'gmt' || key === 'z') return 'UTC';
  return KNOWN.get(key) ?? null;
}

/** "Asia/Tashkent" → "Tashkent"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function cityOfTimeZone(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}
