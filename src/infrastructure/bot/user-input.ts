import type { User as TelegramUser } from 'grammy/types';
import type { User } from '@domain/user';
import type { EnsureUserInput } from '@usecases/user/ensure-user/types';
import { getEnv } from '@common/config';

/**
 * EnsureUser input from a Telegram sender. New users start with the owner's
 * configured timezone (if any) instead of null, so the very first "5 pm" is
 * parsed in the right zone even before the Mini App detects it.
 */
export function toEnsureUserInput(from: TelegramUser): EnsureUserInput {
  const timezone = getEnv().OWNER_TIMEZONE;
  return {
    telegramUserId: from.id,
    firstName: from.first_name,
    ...(from.last_name ? { lastName: from.last_name } : {}),
    ...(from.username ? { username: from.username } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

/** The zone to parse and show times in for this user. */
export function resolveTimezone(user: Pick<User, 'timezone'>): string {
  return user.timezone ?? getEnv().OWNER_TIMEZONE ?? 'UTC';
}
