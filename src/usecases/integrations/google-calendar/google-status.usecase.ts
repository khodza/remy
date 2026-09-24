import { Inject, Injectable, Logger } from '@nestjs/common';
import { Domain } from '@common/tokens';
import type {
  GoogleCalendarGateway,
  GoogleConnectionRepository,
} from '@domain/integrations/google-calendar';
import { ensureAccessToken } from './access-token';
import { markSelected } from './day-events';
import type { GoogleStatus } from './types';

export type GoogleStatusInput = { userId: string; now?: Date };

/**
 * Configured? Connected? As whom, and which calendars feed the brief. The
 * calendar list needs Google; when it cannot be reached the status still
 * says "connected" and leaves `calendars` out.
 */
@Injectable()
export class GetGoogleStatusUsecase {
  private readonly logger = new Logger(GetGoogleStatusUsecase.name);

  constructor(
    @Inject(Domain.Integrations.GoogleConnectionRepository)
    private readonly connections: GoogleConnectionRepository,
    @Inject(Domain.Integrations.GoogleCalendarGateway)
    private readonly google: GoogleCalendarGateway,
  ) {}

  public async execute(input: GoogleStatusInput): Promise<GoogleStatus> {
    const configured = this.google.isConfigured();
    const connection = await this.connections.findByUserId(input.userId);
    if (!connection) return { configured, connected: false };
    const status: GoogleStatus = {
      configured,
      connected: true,
      email: connection.email,
    };
    if (!configured) return status;
    try {
      const token = await ensureAccessToken(
        connection,
        this.google,
        this.connections,
        input.now,
      );
      const calendars = await this.google.listCalendars(token);
      return { ...status, calendars: markSelected(connection, calendars) };
    } catch (error) {
      this.logger.warn(
        `Could not list Google calendars: ${(error as Error)?.message ?? error}`,
      );
      return status;
    }
  }
}
