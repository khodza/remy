import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Injectable } from '@nestjs/common';
import {
  UserRepository,
  User,
  CreateUserParams,
  UpdateUserParams,
} from '@domain/user/repository';
import { UserDocument, UserHydratedDocument } from './document';
import { Collections } from '../collections';
import { UserNotFoundError, FailedToSaveUserError } from '@domain/user/errors';
import { ApplicationError } from '@domain/error';

@Injectable()
export class UserRepositoryImpl implements UserRepository {
  constructor(
    @InjectModel(Collections.Users)
    private readonly model: Model<UserHydratedDocument>,
  ) {}

  public async save(params: CreateUserParams): Promise<User> {
    try {
      const doc = await this.model.findOneAndUpdate(
        { telegram_user_id: params.telegramUserId },
        {
          $set: {
            first_name: params.firstName,
            last_name: params.lastName ?? null,
            username: params.username ?? null,
            ...(params.timezone !== undefined && { timezone: params.timezone }),
          },
          $setOnInsert: {
            telegram_user_id: params.telegramUserId,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      if (!doc) {
        throw new Error('Failed to save user');
      }

      return this.documentToEntity(doc);
    } catch (error) {
      throw new FailedToSaveUserError('Failed to save user', error);
    }
  }

  public async findByTelegramUserId(
    telegramUserId: number,
  ): Promise<User | null> {
    const doc = await this.model.findOne({ telegram_user_id: telegramUserId });
    return doc ? this.documentToEntity(doc) : null;
  }

  public async findById(id: string): Promise<User | null> {
    const doc = await this.model.findById(id);
    return doc ? this.documentToEntity(doc) : null;
  }

  public async update(params: UpdateUserParams): Promise<User> {
    try {
      const updateData: Record<string, unknown> = {};
      if (params.timezone !== undefined)
        updateData['timezone'] = params.timezone;

      const doc = await this.model.findByIdAndUpdate(
        params.id,
        { $set: updateData },
        { new: true },
      );

      if (!doc) {
        throw new UserNotFoundError(`User with id ${params.id} not found`);
      }

      return this.documentToEntity(doc);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new FailedToSaveUserError('Failed to update user', error);
    }
  }

  private documentToEntity(document: UserDocument): User {
    return {
      id: document._id.toHexString(),
      telegramUserId: document.telegram_user_id,
      firstName: document.first_name,
      lastName: document.last_name,
      username: document.username,
      timezone: document.timezone,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    };
  }
}
