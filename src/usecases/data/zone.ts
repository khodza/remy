import { getEnv } from '@common/config';
import type { User } from '@domain/user';

/** The zone every time is written in: profile, else the owner default. */
export function userZone(user: Pick<User, 'timezone'>): string {
  return user.timezone ?? getEnv().OWNER_TIMEZONE ?? 'UTC';
}
