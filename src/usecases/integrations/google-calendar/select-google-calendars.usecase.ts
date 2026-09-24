import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import { InvalidInputError } from '@common/errors';
import {
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  type GoogleCalendarGateway,
  type GoogleConnectionRepository,
} from '@domain/integrations/google-calendar';
import { ensureAccessToken } from './access-token';
import { markSelected } from './day-events';
import type { GoogleStatus } from './types';

export type SelectGoogleCalendarsInput = {
  userId: string;
  /** Empty = back to the primary calendar only. */
  calendarIds: string[];
  now?: Date;
};

/** Which of the account's calendars feed the brief. Ids are checked against Google's list. */
@Injectable()
export class SelectGoogleCalendarsUsecase {
  constructor(
    @Inject(Domain.Integrations.GoogleConnectionRepository)
    private readonly connections: GoogleConnectionRepository,
    @Inject(Domain.Integrations.GoogleCalendarGateway)
    private readonly google: GoogleCalendarGateway,
  ) {}

  public async execute(
    input: SelectGoogleCalendarsInput,
  ): Promise<GoogleStatus> {
    if (!this.google.isConfigured()) throw new GoogleNotConfiguredError();
    const connection = await this.connections.findByUserId(input.userId);
    if (!connection) throw new GoogleNotConnectedError();

    const token = await ensureAccessToken(
      connection,
      this.google,
      this.connections,
      input.now,
    );
    const calendars = await this.google.listCalendars(token);
    const known = new Set(calendars.map((c) => c.id));
    const ids = [...new Set(input.calendarIds)];
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new InvalidInputError(
        `Unknown calendar${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      );
    }
    await this.connections.updateSelection(input.userId, ids);
    return {
      configured: true,
      connected: true,
      email: connection.email,
      calendars: markSelected({ selectedCalendarIds: ids }, calendars),
    };
  }
}
