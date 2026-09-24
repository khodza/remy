import { StartGoogleConnectUsecase } from './start-google-connect.usecase';
import { GoogleNotConfiguredError } from '@domain/integrations/google-calendar';
import {
  fakeStateSigner,
  mockGoogleCalendarGateway,
} from '@test/google-factories';

describe('StartGoogleConnectUsecase', () => {
  it('signs a state for the user and returns the consent URL', async () => {
    const google = mockGoogleCalendarGateway();
    const usecase = new StartGoogleConnectUsecase(google, fakeStateSigner());
    expect(await usecase.execute({ userId: 'user-1' })).toEqual({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-for-user-1',
    });
  });

  it('refuses when the OAuth client is not configured', async () => {
    const usecase = new StartGoogleConnectUsecase(
      mockGoogleCalendarGateway({ configured: false }),
      fakeStateSigner(),
    );
    await expect(usecase.execute({ userId: 'user-1' })).rejects.toThrow(
      GoogleNotConfiguredError,
    );
  });
});
