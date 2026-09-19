import type { DigestKind } from '@domain/rhythm';
import { User, CreateUserParams, UpdateUserParams } from './types';

export interface UserRepository {
  save(params: CreateUserParams): Promise<User>;
  findByTelegramUserId(telegramUserId: number): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  update(params: UpdateUserParams): Promise<User>;
  listAll(): Promise<User[]>;
  /**
   * Marks a digest as sent for the user's local date. Atomic: returns true
   * for exactly one caller per (user, kind, date), false if already sent.
   */
  claimDigest(
    userId: string,
    kind: DigestKind,
    localDate: string,
  ): Promise<boolean>;
}
