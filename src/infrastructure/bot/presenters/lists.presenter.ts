import { InlineKeyboard } from 'grammy';
import type { ListSummary } from '@domain/task';
import { escapeHtml } from '../html';
import type { BotReply } from './assistant.presenter';

/** Callback prefix of the "show this list" buttons under /lists. */
export const LIST_CALLBACK_PREFIX = 'lst:';

/** /lists: every named list with its open and done counts, one button each. */
export function presentLists(lists: ListSummary[]): BotReply {
  if (lists.length === 0) {
    return {
      html: '🗂 <b>Your lists</b>\n\nNo lists yet. Say “add milk to the shopping list” or “ideas: learn Rust” and a list appears here.',
    };
  }
  const lines = lists.map((l) => {
    const done = l.completed > 0 ? ` · ${l.completed} done` : '';
    return `• <b>${escapeHtml(l.name)}</b> · ${l.pending} open${done}`;
  });
  const keyboard = new InlineKeyboard();
  lists.forEach((l, i) => {
    // Two buttons per row; a trailing empty row is invalid.
    if (i > 0 && i % 2 === 0) keyboard.row();
    keyboard.text(
      `🗂 ${l.name.slice(0, 30)}`,
      `${LIST_CALLBACK_PREFIX}${l.name.slice(0, 40)}`,
    );
  });
  return {
    html: `🗂 <b>Your lists</b>\n\n${lines.join('\n')}\n\n<i>Tap a list to see it, or say “what's on my shopping list?”, “add eggs to it”, “clear the shopping list”.</i>`,
    keyboard,
  };
}
