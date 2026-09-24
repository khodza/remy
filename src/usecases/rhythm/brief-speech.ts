import { formatInTimeZone } from 'date-fns-tz';
import type { MorningBrief } from '@domain/rhythm';
import { effectiveDueAt } from '@common/fire-time';

const SPOKEN_TODAY_MAX = 12;
const SPOKEN_OVERDUE_MAX = 3;

/**
 * The morning brief as something to be read aloud: short sentences, no
 * markup, every time in the user's zone and clock style, the long tail
 * summarised. What the text brief numbers, the voice lists in order.
 */
export function briefSpeechText(
  brief: MorningBrief,
  options: { hour12: boolean },
): string {
  const tz = brief.timezone;
  const clock = options.hour12 ? 'h:mm a' : 'HH:mm';
  const parts: string[] = [
    `Good morning, ${brief.firstName}. It's ${formatInTimeZone(brief.now, tz, 'EEEE, d MMMM')}.`,
  ];

  if (brief.today.length === 0) {
    parts.push('Nothing is scheduled for today.');
  } else {
    parts.push(
      brief.today.length === 1
        ? 'You have one thing today.'
        : `You have ${brief.today.length} things today.`,
    );
    for (const task of brief.today.slice(0, SPOKEN_TODAY_MAX)) {
      const due = effectiveDueAt(task);
      const when =
        task.allDay || !due
          ? 'Any time today'
          : `At ${formatInTimeZone(due, tz, clock)}`;
      parts.push(`${when}, ${sentence(task.description)}`);
    }
    if (brief.today.length > SPOKEN_TODAY_MAX) {
      parts.push(`And ${brief.today.length - SPOKEN_TODAY_MAX} more.`);
    }
  }

  if (brief.overdue.length > 0) {
    const names = brief.overdue
      .slice(0, SPOKEN_OVERDUE_MAX)
      .map((t) => t.description.trim());
    const rest = brief.overdue.length - names.length;
    parts.push(
      `${brief.overdue.length === 1 ? 'One thing is' : `${brief.overdue.length} things are`} still open from before: ${names.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}.`,
    );
  }

  if (brief.undelivered.length > 0) {
    parts.push(
      brief.undelivered.length === 1
        ? `One reminder could not be delivered: ${brief.undelivered[0]!.description.trim()}.`
        : `${brief.undelivered.length} reminders could not be delivered; they are in the written brief.`,
    );
  }

  if (brief.inboxCount > 0) {
    parts.push(
      brief.inboxCount === 1
        ? 'One thing in the Inbox has no date yet.'
        : `${brief.inboxCount} things in the Inbox have no date yet.`,
    );
  }

  parts.push('Have a good day!');
  return parts.join(' ');
}

/** A title as a spoken sentence: trimmed, ending in a full stop. */
function sentence(title: string): string {
  const text = title.trim().replace(/\s+/g, ' ');
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
