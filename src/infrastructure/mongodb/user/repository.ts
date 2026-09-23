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
import { DEFAULT_USER_SETTINGS, type UserSettings } from '@domain/user';
import type { DigestKind } from '@domain/rhythm';

const DIGEST_FIELD: Record<
  DigestKind,
  'last_brief_on' | 'last_review_on' | 'last_wrap_on'
> = {
  brief: 'last_brief_on',
  review: 'last_review_on',
  wrap: 'last_wrap_on',
};
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

  public async findByCalendarToken(token: string): Promise<User | null> {
    const doc = await this.model.findOne({ calendar_token: token });
    return doc ? this.documentToEntity(doc) : null;
  }

  public async update(params: UpdateUserParams): Promise<User> {
    try {
      const updateData: Record<string, unknown> = {};
      if (params.timezone !== undefined)
        updateData['timezone'] = params.timezone;
      if (params.settings !== undefined)
        updateData['settings'] = params.settings;
      if (params.categories !== undefined)
        updateData['categories'] = params.categories;
      if (params.calendarToken !== undefined)
        updateData['calendar_token'] = params.calendarToken;

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

  public async listAll(): Promise<User[]> {
    const docs = await this.model.find({});
    return docs.map((doc) => this.documentToEntity(doc));
  }

  public async claimDigest(
    userId: string,
    kind: DigestKind,
    localDate: string,
  ): Promise<boolean> {
    const field = DIGEST_FIELD[kind];
    const result = await this.model.updateOne(
      { _id: userId, [field]: { $ne: localDate } },
      { $set: { [field]: localDate } },
      { timestamps: false },
    );
    return result.modifiedCount === 1;
  }

  public async releaseDigest(
    userId: string,
    kind: DigestKind,
    localDate: string,
  ): Promise<void> {
    const field = DIGEST_FIELD[kind];
    await this.model.updateOne(
      { _id: userId, [field]: localDate },
      { $set: { [field]: null } },
      { timestamps: false },
    );
  }

  private documentToEntity(document: UserDocument): User {
    return {
      id: document._id.toHexString(),
      telegramUserId: document.telegram_user_id,
      firstName: document.first_name,
      lastName: document.last_name,
      username: document.username,
      timezone: document.timezone,
      settings: mergeSettings(document.settings),
      categories: document.categories
        ? document.categories.map((c) => ({
            id: c.id,
            name: c.name,
            emoji: c.emoji,
            color: c.color,
            keywords: [...(c.keywords ?? [])],
          }))
        : null,
      calendarToken: document.calendar_token ?? null,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    };
  }
}

/** Stored settings may predate newer keys; fill the gaps with defaults. */
function mergeSettings(
  stored: Partial<UserSettings> | null | undefined,
): UserSettings {
  const d = DEFAULT_USER_SETTINGS;
  const s = stored ?? {};
  return {
    hour12: s.hour12 ?? d.hour12,
    weekStartsOn: s.weekStartsOn ?? d.weekStartsOn,
    defaultView: s.defaultView ?? d.defaultView,
    morningBrief: { ...d.morningBrief, ...s.morningBrief },
    eveningReview: { ...d.eveningReview, ...s.eveningReview },
    quietHours: { ...d.quietHours, ...s.quietHours },
    escalation: {
      enabled: s.escalation?.enabled ?? d.escalation.enabled,
      stepsMinutes: [
        ...(s.escalation?.stepsMinutes ?? d.escalation.stepsMinutes),
      ],
    },
    weeklyWrap: { ...d.weeklyWrap, ...s.weeklyWrap },
    voiceBrief: s.voiceBrief ?? d.voiceBrief,
    pinnedAgenda: s.pinnedAgenda ?? d.pinnedAgenda,
  };
}
