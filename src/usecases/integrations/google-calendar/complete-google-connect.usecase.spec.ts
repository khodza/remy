import { CompleteGoogleConnectUsecase } from './complete-google-connect.usecase';
import {
  GoogleApiError,
  InvalidConnectStateError,
} from '@domain/integrations/google-calendar';
import { makeUser, mockUserRepository } from '@test/factories';
import {
  fakeStateSigner,
  makeGoogleConnection,
  mockGoogleCalendarGateway,
  mockGoogleConnectionNotifier,
  mockGoogleConnectionRepository,
} from '@test/google-factories';

function setup(
  initial = null as ReturnType<typeof makeGoogleConnection> | null,
) {
  const google = mockGoogleCalendarGateway();
  const connections = mockGoogleConnectionRepository(initial);
  const notifier = mockGoogleConnectionNotifier();
  const users = mockUserRepository(
    makeUser({ id: 'user-1', telegramUserId: 42 }),
  );
  const usecase = new CompleteGoogleConnectUsecase(
    google,
    fakeStateSigner(),
    connections,
    users,
    notifier,
  );
  return { usecase, google, connections, notifier };
}

describe('CompleteGoogleConnectUsecase', () => {
  it('verifies the state, exchanges the code, stores the tokens and tells the chat', async () => {
    const { usecase, google, connections, notifier } = setup();
    const result = await usecase.execute({
      code: '4/abc',
      state: 'state-for-user-1',
    });
    expect(result).toEqual({ userId: 'user-1', email: 'owner@example.com' });
    expect(google.exchangeCode).toHaveBeenCalledWith('4/abc');
    expect(connections.current()).toMatchObject({
      userId: 'user-1',
      email: 'owner@example.com',
      refreshToken: 'rt-for-4/abc',
      accessToken: 'at-for-4/abc',
    });
    expect(notifier.connected).toHaveBeenCalledWith({
      chatId: 42,
      email: 'owner@example.com',
    });
  });

  it('rejects a bad state or an unknown user before touching Google', async () => {
    const { usecase, google } = setup();
    await expect(
      usecase.execute({ code: 'c', state: 'forged' }),
    ).rejects.toThrow(InvalidConnectStateError);
    await expect(
      usecase.execute({ code: 'c', state: 'state-for-nobody' }),
    ).rejects.toThrow(InvalidConnectStateError);
    expect(google.exchangeCode).not.toHaveBeenCalled();
  });

  it('keeps the old refresh token when Google sends none on a re-consent, else fails clearly', async () => {
    const { usecase, google, connections } = setup(
      makeGoogleConnection({ refreshToken: 'rt-old' }),
    );
    google.exchangeCode.mockResolvedValue({
      accessToken: 'at-new',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await usecase.execute({ code: 'c', state: 'state-for-user-1' });
    expect(connections.current()).toMatchObject({
      refreshToken: 'rt-old',
      accessToken: 'at-new',
    });

    const fresh = setup();
    fresh.google.exchangeCode.mockResolvedValue({
      accessToken: 'at-new',
      refreshToken: null,
      expiresAt: new Date(),
    });
    await expect(
      fresh.usecase.execute({ code: 'c', state: 'state-for-user-1' }),
    ).rejects.toThrow(GoogleApiError);
    expect(fresh.connections.current()).toBeNull();
  });

  it('connects without the e-mail when userinfo fails; a failed chat message is not fatal', async () => {
    const { usecase, google, notifier, connections } = setup();
    google.fetchEmail.mockRejectedValue(new GoogleApiError('userinfo down'));
    notifier.connected.mockRejectedValue(new Error('blocked'));
    const result = await usecase.execute({
      code: 'c',
      state: 'state-for-user-1',
    });
    expect(result.email).toBeNull();
    expect(connections.current()?.email).toBeNull();
  });
});
