import { DisconnectGoogleUsecase } from './disconnect-google.usecase';
import {
  makeGoogleConnection,
  mockGoogleCalendarGateway,
  mockGoogleConnectionRepository,
} from '@test/google-factories';

describe('DisconnectGoogleUsecase', () => {
  it('revokes the refresh token and forgets the connection', async () => {
    const google = mockGoogleCalendarGateway();
    const connections = mockGoogleConnectionRepository(makeGoogleConnection());
    const usecase = new DisconnectGoogleUsecase(connections, google);
    expect(await usecase.execute({ userId: 'user-1' })).toEqual({
      configured: true,
      connected: false,
    });
    expect(google.revoke).toHaveBeenCalledWith('rt-1');
    expect(connections.current()).toBeNull();
  });

  it('is idempotent and survives a failed revoke', async () => {
    const google = mockGoogleCalendarGateway();
    google.revoke.mockRejectedValue(new Error('offline'));
    const connections = mockGoogleConnectionRepository(makeGoogleConnection());
    const usecase = new DisconnectGoogleUsecase(connections, google);
    await usecase.execute({ userId: 'user-1' });
    expect(connections.current()).toBeNull();
    expect(await usecase.execute({ userId: 'user-1' })).toEqual({
      configured: true,
      connected: false,
    });
    expect(google.revoke).toHaveBeenCalledTimes(1);
  });
});
