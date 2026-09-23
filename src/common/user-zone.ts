import { getEnv } from '@common/config';
import type { User } from '@domain/user';

/**
 * The zone every time is written and read in for the user: the profile
 * zone, else OWNER_TIMEZONE, else UTC. Every Mini App route uses this one.
 */
export function userZone(user: Pick<User, 'timezone'>): string {
  return user.timezone ?? getEnv().OWNER_TIMEZONE ?? 'UTC';
}
