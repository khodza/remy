import {
  CONNECT_STATE_TTL_MS,
  ConnectStateSignerImpl,
} from './connect-state.signer';

const secret = 'a-test-secret-that-is-long-enough-for-hkdf-1234';

describe('ConnectStateSignerImpl', () => {
  const signer = new ConnectStateSignerImpl(secret);
  const now = new Date('2026-09-24T08:00:00Z');

  it('verifies its own state for the same user within the TTL', () => {
    const state = signer.sign('user-1', now);
    expect(state).not.toContain('user-1'); // the id travels base64url-encoded
    expect(signer.verify(state, now)).toEqual({ userId: 'user-1' });
    expect(
      signer.verify(state, new Date(now.getTime() + CONNECT_STATE_TTL_MS - 1)),
    ).toEqual({ userId: 'user-1' });
    expect(
      signer.verify(state, new Date(now.getTime() + CONNECT_STATE_TTL_MS + 1)),
    ).toBeNull();
  });

  it('rejects a forged, tampered or foreign state', () => {
    const state = signer.sign('user-1', now);
    const [user, exp, nonce, mac] = state.split('.') as [
      string,
      string,
      string,
      string,
    ];
    const otherUser = Buffer.from('user-2').toString('base64url');
    expect(
      signer.verify(`${otherUser}.${exp}.${nonce}.${mac}`, now),
    ).toBeNull();
    expect(
      signer.verify(`${user}.${Number(exp) + 9}.${nonce}.${mac}`, now),
    ).toBeNull();
    expect(signer.verify('garbage', now)).toBeNull();
    expect(signer.verify('', now)).toBeNull();
    const other = new ConnectStateSignerImpl(`${secret}-other`);
    expect(other.verify(state, now)).toBeNull();
  });
});
