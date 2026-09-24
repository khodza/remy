/** UserRepositoryImpl's calendar feed token against a real (in-memory) MongoDB. */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { UserSchema } from '@infra/mongodb/user/schema';
import { UserRepositoryImpl } from '@infra/mongodb/user/repository';
import type { UserDocument } from '@infra/mongodb/user/document';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';

describe('calendar feed token (real MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let users: UserRepositoryImpl;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const model = mongoose.model<UserDocument>('UserFeed', UserSchema);
    await model.syncIndexes();
    users = new UserRepositoryImpl(model as never);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('finds the owner by token, and many users without one do not collide', async () => {
    const a = await users.save({ telegramUserId: 1, firstName: 'A' });
    const b = await users.save({ telegramUserId: 2, firstName: 'B' });
    // Both start with a null token: the partial index must allow that.
    expect(a.calendarToken).toBeNull();
    expect(b.calendarToken).toBeNull();

    const token = 'x'.repeat(43);
    const updated = await users.update({ id: a.id, calendarToken: token });
    expect(updated.calendarToken).toBe(token);
    expect((await users.findByCalendarToken(token))?.id).toBe(a.id);
    expect(await users.findByCalendarToken('y'.repeat(43))).toBeNull();

    // Two users can never share a link.
    await expect(
      users.update({ id: b.id, calendarToken: token }),
    ).rejects.toThrow();

    await users.update({ id: a.id, calendarToken: null });
    expect(await users.findByCalendarToken(token)).toBeNull();
    // Turning it off doesn't disturb other fields.
    expect((await users.findById(a.id))?.firstName).toBe('A');
  });

  it('EnsureUser refresh: save() on an existing user changes the names only', async () => {
    const created = await users.save({
      telegramUserId: 3,
      firstName: 'Old',
      lastName: 'Name',
      username: 'old',
      timezone: 'Asia/Tashkent',
    });
    await users.update({
      id: created.id,
      calendarToken: 'z'.repeat(43),
    });

    const ensure = new EnsureUserUsecase(users);
    const refreshed = await ensure.execute({
      telegramUserId: 3,
      firstName: 'New',
      username: 'new',
      timezone: 'Europe/Berlin', // only applied on create
    });

    expect(refreshed.id).toBe(created.id);
    expect(refreshed).toMatchObject({
      firstName: 'New',
      lastName: null,
      username: 'new',
      timezone: 'Asia/Tashkent',
      calendarToken: 'z'.repeat(43),
    });
    expect(await users.findById(created.id)).toMatchObject({
      firstName: 'New',
      timezone: 'Asia/Tashkent',
    });
  });

  it('pinned agenda state round-trips and clears', async () => {
    const u = await users.save({ telegramUserId: 4, firstName: 'C' });
    expect(u.pinnedAgenda).toBeNull();
    const updatedAt = new Date('2026-09-17T05:00:00Z');
    const state = {
      messageId: 500,
      fingerprint: 'abc',
      updatedAt,
      dirty: false,
    };
    expect(
      (await users.update({ id: u.id, pinnedAgenda: state })).pinnedAgenda,
    ).toEqual(state);
    expect(
      (
        await users.update({
          id: u.id,
          pinnedAgenda: { ...state, dirty: true },
        })
      ).pinnedAgenda,
    ).toEqual({ ...state, dirty: true });
    expect((await users.findById(u.id))?.pinnedAgenda?.dirty).toBe(true);
    expect(
      (await users.update({ id: u.id, pinnedAgenda: null })).pinnedAgenda,
    ).toBeNull();
  });
});
