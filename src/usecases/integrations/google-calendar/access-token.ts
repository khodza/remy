import type {
  GoogleCalendarGateway,
  GoogleConnection,
  GoogleConnectionRepository,
} from '@domain/integrations/google-calendar';

/** Refresh this long before the access token expires, not after. */
export const ACCESS_TOKEN_MARGIN_MS = 60_000;

/**
 * A usable access token for the connection: the stored one while it has a
 * minute left, else a fresh one from the refresh token (persisted, so the
 * next call within the hour costs no round trip). Throws GoogleAuthError
 * when Google no longer honours the grant.
 */
export async function ensureAccessToken(
  connection: GoogleConnection,
  gateway: GoogleCalendarGateway,
  connections: GoogleConnectionRepository,
  now: Date = new Date(),
): Promise<string> {
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() - now.getTime() >
      ACCESS_TOKEN_MARGIN_MS
  ) {
    return connection.accessToken;
  }
  const tokens = await gateway.refreshAccessToken(connection.refreshToken);
  await connections.updateAccessToken(
    connection.userId,
    tokens.accessToken,
    tokens.expiresAt,
  );
  return tokens.accessToken;
}
