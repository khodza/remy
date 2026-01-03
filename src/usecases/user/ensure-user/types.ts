import { User } from '@domain/user';

export type EnsureUserInput = {
  telegramUserId: number;
  firstName: string;
  lastName?: string;
  username?: string;
};

export type EnsureUserOutput = User;
