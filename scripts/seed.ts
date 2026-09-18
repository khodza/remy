/**
 * Seeds a realistic day for the owner so the bot and the Mini App have
 * something to show: overdue, later today, recurring, snoozed, done, todos.
 *
 *   npm run seed              insert (on top of whatever exists)
 *   npm run seed -- --reset   remove previously seeded tasks first
 *   npm run seed -- --dry-run print what would be inserted, touch nothing
 *
 * Seeded tasks are recognisable by source.original_text starting "[seed]".
 * Requires OWNER_TELEGRAM_ID (the tasks must belong to someone).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { addDays, addHours, addMinutes, set } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { getEnv } from '../src/common/config';
import { TaskSchema } from '../src/infrastructure/mongodb/task/schema';
import { UserSchema } from '../src/infrastructure/mongodb/user/schema';

const SEED_MARK = '[seed]';

type SeedTask = {
  description: string;
  at: Date | null;
  notes?: string;
  priority?: 'low' | 'normal' | 'high';
  recurrence?: { type: string; intervalDays?: number };
  snoozeMinutes?: number;
  done?: boolean;
  sourceType?: 'text' | 'voice' | 'forward' | 'miniapp';
  forwardedFrom?: string;
};

function buildTasks(now: Date, timezone: string): SeedTask[] {
  const zonedNow = toZonedTime(now, timezone);
  /** Wall-clock time today (+dayOffset) in the owner's zone → instant. */
  const at = (hours: number, minutes = 0, dayOffset = 0): Date =>
    fromZonedTime(
      set(addDays(zonedNow, dayOffset), {
        hours,
        minutes,
        seconds: 0,
        milliseconds: 0,
      }),
      timezone,
    );

  return [
    {
      description: 'Call the dentist to move the appointment',
      at: addHours(now, -3),
      priority: 'high',
      notes: 'Ask for a Friday slot, not Thursday.',
      sourceType: 'forward',
      forwardedFrom: "Dr. Karimova's clinic",
    },
    {
      description: 'Pay the electricity bill',
      at: addMinutes(now, -75),
      recurrence: { type: 'monthly' },
    },
    {
      description: 'Send standup notes to Alisher',
      at: addMinutes(now, 45),
      recurrence: { type: 'weekdays' },
    },
    { description: 'Pick up dry cleaning', at: addHours(now, 3) },
    {
      description: 'Call mom',
      at: addHours(now, 4),
      recurrence: { type: 'weekly' },
      sourceType: 'voice',
    },
    {
      description: 'Take vitamins',
      at: addMinutes(now, -20),
      recurrence: { type: 'daily' },
      snoozeMinutes: 40,
    },
    { description: 'Morning run', at: at(7), done: true },
    { description: 'Reply to the landlord', at: at(10), done: true },
    { description: 'Dentist', at: at(10, 0, 1) },
    { description: 'Football with Bekzod', at: at(19, 30, 1) },
    {
      description: 'Weekly review',
      at: at(17, 0, 3),
      recurrence: { type: 'weekly' },
    },
    {
      description: 'Water the plants',
      at: at(9, 0, 2),
      recurrence: { type: 'every_n_days', intervalDays: 3 },
    },
    { description: 'Buy new headphones', at: null, sourceType: 'miniapp' },
    {
      description: 'Book the Samarkand trip',
      at: null,
      notes: 'Check the Afrosiyob train times.',
    },
  ];
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed with NODE_ENV=production');
  }
  if (env.OWNER_TELEGRAM_ID === undefined) {
    throw new Error(
      'Set OWNER_TELEGRAM_ID in .env: seeded tasks need an owner',
    );
  }
  const timezone = env.OWNER_TIMEZONE ?? 'UTC';
  const now = new Date();
  const tasks = buildTasks(now, timezone);

  if (args.has('--dry-run')) {
    console.log(
      `Would seed ${tasks.length} tasks for Telegram user ${env.OWNER_TELEGRAM_ID} in ${timezone}:`,
    );
    for (const t of tasks) {
      console.log(
        `  ${t.at ? t.at.toISOString() : '(no date)          '}  ${t.done ? '✓' : ' '} ${t.description}`,
      );
    }
    return;
  }

  await mongoose.connect(env.MONGODB_URI);
  const User = mongoose.model('SeedUser', UserSchema, 'users');
  const Task = mongoose.model('SeedTask', TaskSchema, 'tasks');

  const user = await User.findOneAndUpdate(
    { telegram_user_id: env.OWNER_TELEGRAM_ID },
    {
      $setOnInsert: {
        telegram_user_id: env.OWNER_TELEGRAM_ID,
        first_name: 'Owner',
        timezone,
      },
    },
    { upsert: true, new: true },
  );
  if (!user) throw new Error('Could not upsert the owner user');
  const userId = user._id.toHexString();

  if (args.has('--reset')) {
    const removed = await Task.deleteMany({
      user_id: userId,
      'source.original_text': { $regex: `^\\${SEED_MARK}` },
    });
    console.log(`Removed ${removed.deletedCount} previously seeded tasks`);
  }

  const docs = tasks.map((t) => {
    const snoozedUntil =
      t.at && t.snoozeMinutes ? addMinutes(now, t.snoozeMinutes) : null;
    return {
      user_id: userId,
      telegram_chat_id: env.OWNER_TELEGRAM_ID,
      description: t.description,
      notes: t.notes ?? null,
      scheduled_at: t.at,
      timezone,
      snoozed_until: snoozedUntil,
      next_fire_at: t.at ? (snoozedUntil ?? t.at) : null,
      next_attempt_at: null,
      lead_minutes: null,
      status: t.done ? 'completed' : 'pending',
      priority: t.priority ?? 'normal',
      category_id: null,
      recurrence:
        t.recurrence && t.at ? { ...t.recurrence, anchorAt: t.at } : null,
      source: {
        type: t.sourceType ?? 'text',
        original_text: `${SEED_MARK} ${t.description}`,
        message_id: null,
        forwarded_from: t.forwardedFrom ?? null,
      },
      completed_at: t.done ? (t.at ?? now) : null,
      completions: [],
      // Already "reminded" when in the past, so seeding doesn't fire a burst
      // of reminders the moment the bot starts. Snoozed ones will fire.
      last_sent_at: t.at && t.at < now && !snoozedUntil ? now : null,
    };
  });
  await Task.insertMany(docs);
  console.log(
    `Seeded ${docs.length} tasks for Telegram user ${env.OWNER_TELEGRAM_ID} (${timezone})`,
  );
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
