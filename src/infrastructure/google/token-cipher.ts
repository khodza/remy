import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Encrypts the Google tokens at rest (AES-256-GCM). The key is derived from
 * GOOGLE_TOKEN_KEY (or JWT_SECRET) with HKDF, so the JWT secret itself is
 * never used as a cipher key. Format: "v1.<iv>.<tag>.<ciphertext>" (base64url).
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error('TokenCipher needs a secret of at least 32 characters');
    }
    this.key = Buffer.from(
      hkdfSync('sha256', secret, 'remy-google-tokens', 'aes-256-gcm', 32),
    );
  }

  public seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, b64(iv), b64(tag), b64(data)].join('.');
  }

  /** Throws on a wrong key or a tampered value. */
  public open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !data) {
      throw new Error('Unrecognised sealed token format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url');
}
