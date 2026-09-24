/** GoogleConnectionRepositoryImpl against a real (in-memory) MongoDB: sealed tokens. */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  GoogleConnectionRepositoryImpl,
  GoogleConnectionSchema,
  type GoogleConnectionDocument,
} from '@infra/mongodb/google-connection';
import { TokenCipher } from '@infra/google/token-cipher';

describe('Google connection store (real MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let repo: GoogleConnectionRepositoryImpl;
  let model: mongoose.Model<GoogleConnectionDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    model = mongoose.model<GoogleConnectionDocument>(
      'GoogleConnectionInt',
      GoogleConnectionSchema,
    );
    await model.syncIndexes();
    repo = new GoogleConnectionRepositoryImpl(
      model as never,
      new TokenCipher('an-integration-test-secret-of-32-plus-chars'),
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('saves one connection per user with sealed tokens and reads it back in clear', async () => {
    const expires = new Date('2026-09-24T10:00:00Z');
    const saved = await repo.save({
      userId: 'user-1',
      email: 'owner@example.com',
      refreshToken: 'rt-secret',
      accessToken: 'at-secret',
      accessTokenExpiresAt: expires,
    });
    expect(saved).toMatchObject({
      userId: 'user-1',
      email: 'owner@example.com',
      refreshToken: 'rt-secret',
      accessToken: 'at-secret',
      accessTokenExpiresAt: expires,
      selectedCalendarIds: [],
    });

    const raw = await model.collection.findOne({ user_id: 'user-1' });
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain('rt-secret');
    expect(dump).not.toContain('at-secret');
    expect(raw?.['refresh_token_enc']).toMatch(/^v1\./);

    expect(await repo.findByUserId('user-1')).toMatchObject({
      refreshToken: 'rt-secret',
    });
    expect(await repo.findByUserId('user-2')).toBeNull();
  });

  it('updates the access token and the selection; a re-consent keeps the selection', async () => {
    await repo.updateSelection('user-1', ['a', 'b']);
    await repo.updateAccessToken(
      'user-1',
      'at-next',
      new Date('2026-09-24T11:00:00Z'),
    );
    expect(await repo.findByUserId('user-1')).toMatchObject({
      accessToken: 'at-next',
      accessTokenExpiresAt: new Date('2026-09-24T11:00:00Z'),
      selectedCalendarIds: ['a', 'b'],
    });

    const again = await repo.save({
      userId: 'user-1',
      email: 'new@example.com',
      refreshToken: 'rt-new',
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    expect(again).toMatchObject({
      email: 'new@example.com',
      refreshToken: 'rt-new',
      accessToken: null,
      selectedCalendarIds: ['a', 'b'],
    });
    expect(await model.countDocuments({ user_id: 'user-1' })).toBe(1);
  });

  it('delete reports whether there was something to delete', async () => {
    expect(await repo.delete('user-1')).toBe(true);
    expect(await repo.delete('user-1')).toBe(false);
    expect(await repo.findByUserId('user-1')).toBeNull();
  });

  it('a row sealed with another key cannot be read (no silent plaintext fallback)', async () => {
    await repo.save({
      userId: 'user-3',
      email: null,
      refreshToken: 'rt-3',
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    const other = new GoogleConnectionRepositoryImpl(
      model as never,
      new TokenCipher('a-different-secret-that-is-also-32-chars-long'),
    );
    await expect(other.findByUserId('user-3')).rejects.toThrow();
  });
});
