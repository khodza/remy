/**
 * Sends phrases through the real intent router (OpenAI) and prints what Remy
 * would do. Touches no database and no Telegram.
 *
 *   npm run assistant:try -- "buy milk, call mom at 5, dentist tomorrow 10"
 *   npm run assistant:try            (runs a built-in set of phrases)
 */
import 'dotenv/config';
import { addHours, addMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { getEnv } from '../src/common/config';
import { InterpreterGatewayImpl } from '../src/infrastructure/openai/assistant/gateway';
import type { CandidateTask, Interpretation } from '../src/domain/assistant';

const DEFAULT_PHRASES = [
  'buy milk, call mom at 17:00, dentist tomorrow 10',
  "what's on tomorrow?",
  'done with the dentist',
  'push everything today to tomorrow',
  'gym every mon and thu at 7am until december',
  'remind me about the flight saturday 6pm, 3 hours before',
  'call mom at 5',
  'thanks!',
  'rename the plov one to learn to cook plov',
];

async function main(): Promise<void> {
  const timezone = getEnv().OWNER_TIMEZONE ?? 'Asia/Tashkent';
  const now = new Date();
  const candidates: CandidateTask[] = [
    {
      id: 'standup',
      title: 'Send standup notes to Alisher',
      dueAt: addMinutes(now, 45),
      recurring: true,
    },
    {
      id: 'cleaning',
      title: 'Pick up dry cleaning',
      dueAt: addHours(now, 3),
      recurring: false,
    },
    {
      id: 'dentist',
      title: 'Dentist',
      dueAt: addHours(now, 20),
      recurring: false,
    },
    { id: 'plov', title: 'Learn plov', dueAt: null, recurring: false },
  ];
  const gateway = new InterpreterGatewayImpl();
  const phrases =
    process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_PHRASES;
  const local = (d: Date | null | undefined): string =>
    d ? formatInTimeZone(d, timezone, 'EEE d MMM HH:mm') : '—';

  console.log(
    `now: ${local(now)} (${timezone}); model: ${getEnv().OPENAI_ASSISTANT_MODEL}\n`,
  );
  for (const text of phrases) {
    const started = Date.now();
    let result: Interpretation;
    try {
      result = await gateway.interpret({
        text,
        timezone,
        now,
        candidates,
        categories: ['Work', 'Home', 'Health', 'Errand', 'Personal'],
        replyToTaskIds: [],
        lastTaskIds: [],
        pendingQuestion: null,
        quoted: null,
      });
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause?.message;
      console.log(
        `✗ "${text}"\n   FAILED: ${(error as Error).message}${cause ? ` — ${cause}` : ''}\n`,
      );
      continue;
    }
    console.log(`› "${text}"  (${Date.now() - started} ms)`);
    console.log(`   ${describe(result, local)}\n`);
  }
}

function describe(
  r: Interpretation,
  local: (d: Date | null | undefined) => string,
): string {
  switch (r.intent) {
    case 'create':
      return r.tasks
        .map(
          (t) =>
            `CREATE "${t.title}" @ ${local(t.dueAt)}${t.recurrence ? ` repeat=${JSON.stringify({ ...t.recurrence, until: t.recurrence.until ? local(t.recurrence.until) : undefined })}` : ''}${t.leadMinutes ? ` lead=${t.leadMinutes}m` : ''}${t.categoryName ? ` [${t.categoryName}]` : ''}${t.priority !== 'normal' ? ` !${t.priority}` : ''}`,
        )
        .join('\n   ');
    case 'query':
      return `QUERY range=${r.range}${r.search ? ` search="${r.search}"` : ''}`;
    case 'complete':
      return `COMPLETE ${r.targetIds.join(', ')}`;
    case 'delete':
      return `DELETE ${r.targetIds.join(', ')}`;
    case 'reschedule':
      return `RESCHEDULE ${r.targetIds.join(', ')} → ${r.dueAt ? local(r.dueAt) : `shift ${r.shiftMinutes} min`}`;
    case 'edit':
      return `EDIT ${r.targetId} title=${JSON.stringify(r.title)} notes=${JSON.stringify(r.notes)}`;
    case 'chat':
      return `CHAT "${r.reply}"`;
    case 'unclear':
      return `ASK "${r.question}" options=${JSON.stringify(r.options)}`;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
