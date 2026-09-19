/** "- milk", "* milk", "• milk", "1. milk", "2) milk", "[ ] milk" → "milk". */
const BULLET = /^\s*(?:[-*•·–—]|\d{1,3}[.)]|\[[ xX]?\])\s*/;

/** Non-empty lines of a pasted list, bullets stripped, at most `max`. */
export function splitList(text: string, max = 50): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(BULLET, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, max);
}
