import { TokenCipher } from './token-cipher';

const secret = 'a-test-secret-that-is-long-enough-for-hkdf-1234';

describe('TokenCipher', () => {
  it('round-trips and never stores the plaintext', () => {
    const cipher = new TokenCipher(secret);
    const sealed = cipher.seal('1//refresh-token-value');
    expect(sealed).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(sealed).not.toContain('refresh-token');
    expect(cipher.open(sealed)).toBe('1//refresh-token-value');
    // A fresh IV every time: equal plaintexts do not look equal at rest.
    expect(cipher.seal('x')).not.toBe(cipher.seal('x'));
  });

  it('refuses another key, a tampered value and garbage', () => {
    const sealed = new TokenCipher(secret).seal('secret');
    const other = new TokenCipher(`${secret}-other`);
    expect(() => other.open(sealed)).toThrow();
    const [v, iv, tag, data] = sealed.split('.');
    const flipped = `${v}.${iv}.${tag}.${data![0] === 'A' ? 'B' : 'A'}${data!.slice(1)}`;
    expect(() => new TokenCipher(secret).open(flipped)).toThrow();
    expect(() => new TokenCipher(secret).open('plain')).toThrow(
      'Unrecognised sealed token format',
    );
    expect(() => new TokenCipher('short')).toThrow();
  });
});
