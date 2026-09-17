/**
 * Escapes dynamic text (task descriptions, transcripts, timezone names) for
 * messages sent with `parse_mode: 'HTML'`. Legacy Markdown has no reliable
 * escaping, so a single "_" or "*" in user text made Telegram reject the
 * whole message.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
