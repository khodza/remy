/** Telegram rejects messages over 4096 characters; leave room for markup. */
export const TELEGRAM_MESSAGE_MAX = 4000;

/**
 * Splits pre-rendered lines into messages that each fit under Telegram's
 * limit, never cutting a line in two (a line holds one whole task, so its
 * HTML tags stay balanced). A single oversize line is sent on its own.
 */
export function chunkLines(
  lines: string[],
  max = TELEGRAM_MESSAGE_MAX,
): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const candidate = current === '' ? line : `${current}\n${line}`;
    if (candidate.length <= max || current === '') {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = line;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}
