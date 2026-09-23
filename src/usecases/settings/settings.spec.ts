import { GetSettingsUsecase, UpdateSettingsUsecase } from '.';
import { DEFAULT_USER_SETTINGS } from '@domain/user';
import { InvalidInputError } from '@common/errors';
import { Settings } from '@contract/remy-contract';
import { mockUserRepository } from '@test/factories';

describe('settings use cases', () => {
  it('returns the defaults for a fresh user, and they satisfy the contract', async () => {
    const users = mockUserRepository();
    const settings = await new GetSettingsUsecase(users).execute({
      userId: 'user-1',
    });
    expect(settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(() => Settings.parse(settings)).not.toThrow();
  });

  it('merges a nested partial without touching sibling keys', async () => {
    const users = mockUserRepository();
    const updated = await new UpdateSettingsUsecase(users).execute({
      userId: 'user-1',
      patch: {
        defaultView: 'list',
        quietHours: { from: '22:30' },
        escalation: { stepsMinutes: [15, 60] },
      },
    });
    expect(updated.defaultView).toBe('list');
    expect(updated.quietHours).toEqual({
      ...DEFAULT_USER_SETTINGS.quietHours,
      from: '22:30',
    });
    expect(updated.escalation).toEqual({
      enabled: true,
      stepsMinutes: [15, 60],
    });
    expect(updated.morningBrief).toEqual(DEFAULT_USER_SETTINGS.morningBrief);
    expect(users.current().settings).toEqual(updated);
  });

  it('voiceBrief and pinnedAgenda default off and toggle on their own', async () => {
    const users = mockUserRepository();
    expect(DEFAULT_USER_SETTINGS).toMatchObject({
      voiceBrief: false,
      pinnedAgenda: false,
    });
    const updated = await new UpdateSettingsUsecase(users).execute({
      userId: 'user-1',
      patch: { voiceBrief: true },
    });
    expect(updated).toMatchObject({ voiceBrief: true, pinnedAgenda: false });
    const again = await new UpdateSettingsUsecase(users).execute({
      userId: 'user-1',
      patch: { pinnedAgenda: true },
    });
    expect(again).toMatchObject({ voiceBrief: true, pinnedAgenda: true });
  });

  it.each([
    ['a bad time', { morningBrief: { time: '25:00' } }],
    [
      'non-increasing escalation steps',
      { escalation: { stepsMinutes: [60, 30] } },
    ],
  ])('rejects %s', async (_label, patch) => {
    const users = mockUserRepository();
    await expect(
      new UpdateSettingsUsecase(users).execute({ userId: 'user-1', patch }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(users.update).not.toHaveBeenCalled();
  });
});
