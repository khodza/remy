import { User } from '@domain/user';

export type UpdateTimezoneInput = {
  userId: string;
  timezone: string;
};

export type UpdateTimezoneOutput = User;
