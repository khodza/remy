import { Inject, Injectable } from '@nestjs/common';
import { Domain } from '@common/tokens';
import {
  GoogleNotConfiguredError,
  type ConnectStateSigner,
  type GoogleCalendarGateway,
} from '@domain/integrations/google-calendar';

export type StartGoogleConnectInput = { userId: string; now?: Date };
export type StartGoogleConnectOutput = { url: string };

/** The consent URL for this user, with a signed short-lived state. */
@Injectable()
export class StartGoogleConnectUsecase {
  constructor(
    @Inject(Domain.Integrations.GoogleCalendarGateway)
    private readonly google: GoogleCalendarGateway,
    @Inject(Domain.Integrations.ConnectStateSigner)
    private readonly states: ConnectStateSigner,
  ) {}

  public async execute(
    input: StartGoogleConnectInput,
  ): Promise<StartGoogleConnectOutput> {
    if (!this.google.isConfigured()) throw new GoogleNotConfiguredError();
    const state = this.states.sign(input.userId, input.now);
    return { url: this.google.authorizationUrl(state) };
  }
}
