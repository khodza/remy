import { ensureAccessToken } from './access-token';
import {
  makeGoogleConnection,
  mockGoogleCalendarGateway,
  mockGoogleConnectionRepository,
} from '@test/google-factories';

describe('ensureAccessToken', () => {
  const now = new Date('2026-09-24T03:00:00Z');

  it('uses the stored token while it has more than a minute left', async () => {
    const connection = makeGoogleConnection({
      accessToken: 'at-1',
      accessTokenExpiresAt: new Date(now.getTime() + 61_000),
    });
    const google = mockGoogleCalendarGateway();
    const repo = mockGoogleConnectionRepository(connection);
    expect(await ensureAccessToken(connection, google, repo, now)).toBe('at-1');
    expect(google.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes an expiring or missing token and persists the new one', async () => {
    const expiring = makeGoogleConnection({
      accessToken: 'at-1',
      accessTokenExpiresAt: new Date(now.getTime() + 59_000),
    });
    const google = mockGoogleCalendarGateway();
    const repo = mockGoogleConnectionRepository(expiring);
    expect(await ensureAccessToken(expiring, google, repo, now)).toBe(
      'at-refreshed',
    );
    expect(google.refreshAccessToken).toHaveBeenCalledWith('rt-1');
    expect(repo.updateAccessToken).toHaveBeenCalledWith(
      'user-1',
      'at-refreshed',
      expect.any(Date),
    );
    expect(repo.current()?.accessToken).toBe('at-refreshed');

    const missing = makeGoogleConnection({
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    expect(await ensureAccessToken(missing, google, repo, now)).toBe(
      'at-refreshed',
    );
  });
});
