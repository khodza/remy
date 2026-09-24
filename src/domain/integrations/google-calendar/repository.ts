import type { GoogleConnection, SaveGoogleConnectionParams } from './types';

export interface GoogleConnectionRepository {
  findByUserId(userId: string): Promise<GoogleConnection | null>;
  /**
   * Creates or replaces the connection for the user. A re-consent keeps the
   * previous calendar selection.
   */
  save(params: SaveGoogleConnectionParams): Promise<GoogleConnection>;
  /** After a refresh: the new access token and when it expires. */
  updateAccessToken(
    userId: string,
    accessToken: string,
    expiresAt: Date,
  ): Promise<void>;
  updateSelection(userId: string, calendarIds: string[]): Promise<void>;
  /** True when there was a connection to remove. */
  delete(userId: string): Promise<boolean>;
}
