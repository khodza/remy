export type User = {
  id: string;
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  timezone: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserParams = {
  telegramUserId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  timezone?: string;
};

export type UpdateUserParams = {
  id: string;
  timezone?: string;
};
