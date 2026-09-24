import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  GoogleConnection,
  GoogleConnectionRepository,
  SaveGoogleConnectionParams,
} from '@domain/integrations/google-calendar';
import { TokenCipher } from '@infra/google/token-cipher';
import type {
  GoogleConnectionDocument,
  GoogleConnectionHydratedDocument,
} from './document';
import { GOOGLE_CONNECTIONS_COLLECTION } from './schema';

/**
 * Stores the connection with both tokens encrypted (AES-GCM through
 * TokenCipher); the plaintext never reaches MongoDB. A row is read back
 * decrypted, so the use cases never see ciphertext.
 */
@Injectable()
export class GoogleConnectionRepositoryImpl implements GoogleConnectionRepository {
  constructor(
    @InjectModel(GOOGLE_CONNECTIONS_COLLECTION)
    private readonly model: Model<GoogleConnectionHydratedDocument>,
    private readonly cipher: TokenCipher,
  ) {}

  public async findByUserId(userId: string): Promise<GoogleConnection | null> {
    const doc = await this.model.findOne({ user_id: userId });
    return doc ? this.toEntity(doc) : null;
  }

  public async save(
    params: SaveGoogleConnectionParams,
  ): Promise<GoogleConnection> {
    const doc = await this.model.findOneAndUpdate(
      { user_id: params.userId },
      {
        $set: {
          email: params.email,
          refresh_token_enc: this.cipher.seal(params.refreshToken),
          access_token_enc: params.accessToken
            ? this.cipher.seal(params.accessToken)
            : null,
          access_token_expires_at: params.accessTokenExpiresAt,
          connected_at: new Date(),
        },
        // A re-consent keeps the calendars the owner picked.
        $setOnInsert: { user_id: params.userId, selected_calendar_ids: [] },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!doc) throw new Error('Failed to save the Google connection');
    return this.toEntity(doc);
  }

  public async updateAccessToken(
    userId: string,
    accessToken: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.model.updateOne(
      { user_id: userId },
      {
        $set: {
          access_token_enc: this.cipher.seal(accessToken),
          access_token_expires_at: expiresAt,
        },
      },
    );
  }

  public async updateSelection(
    userId: string,
    calendarIds: string[],
  ): Promise<void> {
    await this.model.updateOne(
      { user_id: userId },
      { $set: { selected_calendar_ids: calendarIds } },
    );
  }

  public async delete(userId: string): Promise<boolean> {
    const result = await this.model.deleteOne({ user_id: userId });
    return result.deletedCount === 1;
  }

  private toEntity(doc: GoogleConnectionDocument): GoogleConnection {
    return {
      userId: doc.user_id,
      email: doc.email ?? null,
      refreshToken: this.cipher.open(doc.refresh_token_enc),
      accessToken: doc.access_token_enc
        ? this.cipher.open(doc.access_token_enc)
        : null,
      accessTokenExpiresAt: doc.access_token_expires_at ?? null,
      selectedCalendarIds: [...(doc.selected_calendar_ids ?? [])],
      connectedAt: doc.connected_at,
      updatedAt: doc.updated_at,
    };
  }
}
