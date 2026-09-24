import { GetGoogleStatusUsecase } from './google-status.usecase';
import { GoogleApiError } from '@domain/integrations/google-calendar';
import {
  familyCalendar,
  makeGoogleConnection,
  mockGoogleCalendarGateway,
  mockGoogleConnectionRepository,
  primaryCalendar,
} from '@test/google-factories';

describe('GetGoogleStatusUsecase', () => {
  it('reports not configured / not connected without touching Google', async () => {
    const google = mockGoogleCalendarGateway({ configured: false });
    const usecase = new GetGoogleStatusUsecase(
      mockGoogleConnectionRepository(),
      google,
    );
    expect(await usecase.execute({ userId: 'user-1' })).toEqual({
      configured: false,
      connected: false,
    });
    expect(google.listCalendars).not.toHaveBeenCalled();
  });

  it('lists the calendars with the selection when connected', async () => {
    const google = mockGoogleCalendarGateway();
    const usecase = new GetGoogleStatusUsecase(
      mockGoogleConnectionRepository(
        makeGoogleConnection({ selectedCalendarIds: [familyCalendar.id] }),
      ),
      google,
    );
    expect(await usecase.execute({ userId: 'user-1' })).toEqual({
      configured: true,
      connected: true,
      email: 'owner@example.com',
      calendars: [
        { id: primaryCalendar.id, summary: 'Owner', selected: false },
        { id: familyCalendar.id, summary: 'Family', selected: true },
      ],
    });
    expect(google.listCalendars).toHaveBeenCalledWith('at-1');
  });

  it('still says connected when Google cannot be reached', async () => {
    const google = mockGoogleCalendarGateway();
    google.listCalendars.mockRejectedValue(new GoogleApiError('down'));
    const usecase = new GetGoogleStatusUsecase(
      mockGoogleConnectionRepository(makeGoogleConnection()),
      google,
    );
    expect(await usecase.execute({ userId: 'user-1' })).toEqual({
      configured: true,
      connected: true,
      email: 'owner@example.com',
    });
  });
});
