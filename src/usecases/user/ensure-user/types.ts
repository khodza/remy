import { User } from '@domain/user';

export type EnsureUserInput = {
  telegramUserId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  /** Applied only when the user is created. */
  timezone?: string;
};

export type EnsureUserOutput = User;
