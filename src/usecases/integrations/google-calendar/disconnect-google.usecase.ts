import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import type {
  GoogleCalendarGateway,
  GoogleConnectionRepository,
} from '@domain/integrations/google-calendar';
import type { GoogleStatus } from './types';

export type DisconnectGoogleInput = { userId: string };

/** Revokes the grant at Google (best effort) and forgets the tokens. */
@Injectable()
export class DisconnectGoogleUsecase {
  constructor(
    @Inject(Domain.Integrations.GoogleConnectionRepository)
    private readonly connections: GoogleConnectionRepository,
    @Inject(Domain.Integrations.GoogleCalendarGateway)
    private readonly google: GoogleCalendarGateway,
  ) {}

  public async execute(input: DisconnectGoogleInput): Promise<GoogleStatus> {
    const configured = this.google.isConfigured();
    const connection = await this.connections.findByUserId(input.userId);
    if (connection) {
      // Revoking the refresh token kills every access token made from it.
      // Even when Google is unreachable the tokens are gone from our side.
      await this.google.revoke(connection.refreshToken).catch(() => undefined);
      await this.connections.delete(input.userId);
    }
    return { configured, connected: false };
  }
}
