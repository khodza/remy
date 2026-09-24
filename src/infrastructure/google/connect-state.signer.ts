import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { ConnectStateSigner } from '@domain/integrations/google-calendar';

/** How long a connect link may sit in the browser before it is used. */
export const CONNECT_STATE_TTL_MS = 10 * 60_000;

/**
 * The OAuth `state`: "<userId>.<expiry>.<nonce>.<hmac>" (base64url parts),
 * signed with a key derived from the app secret. Google hands it back on the
 * callback, which is a public route: the signature is what ties the
 * callback to the owner who asked for it, and the expiry keeps an old link
 * from working forever.
 */
export class ConnectStateSignerImpl implements ConnectStateSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(
      hkdfSync('sha256', secret, 'remy-google-state', 'hmac-sha256', 32),
    );
  }

  public sign(userId: string, now: Date = new Date()): string {
    const payload = [
      Buffer.from(userId, 'utf8').toString('base64url'),
      String(now.getTime() + CONNECT_STATE_TTL_MS),
      randomBytes(8).toString('base64url'),
    ].join('.');
    return `${payload}.${this.mac(payload)}`;
  }

  public verify(
    state: string,
    now: Date = new Date(),
  ): { userId: string } | null {
    const parts = state.split('.');
    if (parts.length !== 4) return null;
    const [user, expiry, nonce, mac] = parts as [
      string,
      string,
      string,
      string,
    ];
    const expected = this.mac([user, expiry, nonce].join('.'));
    const given = Buffer.from(mac, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return null;
    }
    if (!/^\d+$/.test(expiry) || Number(expiry) < now.getTime()) return null;
    const userId = Buffer.from(user, 'base64url').toString('utf8');
    return userId ? { userId } : null;
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
