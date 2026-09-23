/** Longest list name kept. */
export const LIST_NAME_MAX = 40;

/**
 * Named lists ("add milk to the shopping list") are matched by a
 * normalised name: trimmed, single-spaced, lower case, without a leading
 * "the"/"my" or a trailing "list". "My Shopping List" and "shopping" are the
 * same list. Null (no list) for an empty result.
 */
export function normaliseListName(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  let name = raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  name = name.replace(/^(the|my)\s+/u, '');
  name = name.replace(/\s+list$/u, '');
  name = name.slice(0, LIST_NAME_MAX).trim();
  return name === '' ? null : name;
}
