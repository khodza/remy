import { User, CreateUserParams, UpdateUserParams } from './types';

export interface UserRepository {
  save(params: CreateUserParams): Promise<User>;
  findByTelegramUserId(telegramUserId: number): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  update(params: UpdateUserParams): Promise<User>;
}
