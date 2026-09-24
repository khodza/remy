import { SelectGoogleCalendarsUsecase } from './select-google-calendars.usecase';
import { InvalidInputError } from '@common/errors';
import { GoogleNotConnectedError } from '@domain/integrations/google-calendar';
import {
  familyCalendar,
  makeGoogleConnection,
  mockGoogleCalendarGateway,
  mockGoogleConnectionRepository,
  primaryCalendar,
} from '@test/google-factories';

describe('SelectGoogleCalendarsUsecase', () => {
  it('stores a de-duplicated selection that Google knows and returns the status', async () => {
    const connections = mockGoogleConnectionRepository(makeGoogleConnection());
    const usecase = new SelectGoogleCalendarsUsecase(
      connections,
      mockGoogleCalendarGateway(),
    );
    const status = await usecase.execute({
      userId: 'user-1',
      calendarIds: [familyCalendar.id, familyCalendar.id],
    });
    expect(connections.current()?.selectedCalendarIds).toEqual([
      familyCalendar.id,
    ]);
    expect(status.calendars).toEqual([
      { id: primaryCalendar.id, summary: 'Owner', selected: false },
      { id: familyCalendar.id, summary: 'Family', selected: true },
    ]);
    // Empty = back to the primary.
    const reset = await usecase.execute({ userId: 'user-1', calendarIds: [] });
    expect(reset.calendars?.map((c) => c.selected)).toEqual([true, false]);
  });

  it('rejects unknown ids and a user without a connection', async () => {
    const usecase = new SelectGoogleCalendarsUsecase(
      mockGoogleConnectionRepository(makeGoogleConnection()),
      mockGoogleCalendarGateway(),
    );
    await expect(
      usecase.execute({ userId: 'user-1', calendarIds: ['nope'] }),
    ).rejects.toThrow(InvalidInputError);
    const none = new SelectGoogleCalendarsUsecase(
      mockGoogleConnectionRepository(),
      mockGoogleCalendarGateway(),
    );
    await expect(
      none.execute({ userId: 'user-1', calendarIds: [] }),
    ).rejects.toThrow(GoogleNotConnectedError);
  });
});
