import { Inject, Injectable, Logger } from '@nestjs/common';
import { Domain } from '@common/tokens';
import {
  GoogleApiError,
  GoogleNotConfiguredError,
  InvalidConnectStateError,
  type ConnectStateSigner,
  type GoogleCalendarGateway,
  type GoogleConnectionNotifier,
  type GoogleConnectionRepository,
} from '@domain/integrations/google-calendar';
import type { UserRepository } from '@domain/user';

export type CompleteGoogleConnectInput = {
  code: string;
  state: string;
  now?: Date;
};
export type CompleteGoogleConnectOutput = {
  userId: string;
  email: string | null;
};

/**
 * The OAuth callback: the state proves which owner asked (the route itself
 * is public), the code becomes tokens, the tokens are stored encrypted and
 * the bot says "connected" in the chat.
 */
@Injectable()
export class CompleteGoogleConnectUsecase {
  private readonly logger = new Logger(CompleteGoogleConnectUsecase.name);

  constructor(
    @Inject(Domain.Integrations.GoogleCalendarGateway)
    private readonly google: GoogleCalendarGateway,
    @Inject(Domain.Integrations.ConnectStateSigner)
    private readonly states: ConnectStateSigner,
    @Inject(Domain.Integrations.GoogleConnectionRepository)
    private readonly connections: GoogleConnectionRepository,
    @Inject(Domain.User.Repository)
    private readonly users: UserRepository,
    @Inject(Domain.Integrations.GoogleConnectionNotifier)
    private readonly notifier: GoogleConnectionNotifier,
  ) {}

  public async execute(
    input: CompleteGoogleConnectInput,
  ): Promise<CompleteGoogleConnectOutput> {
    if (!this.google.isConfigured()) throw new GoogleNotConfiguredError();
    const verified = this.states.verify(input.state, input.now);
    if (!verified) throw new InvalidConnectStateError();
    const user = await this.users.findById(verified.userId);
    // Same answer as a forged state: never confirm which ids exist.
    if (!user) throw new InvalidConnectStateError();

    const tokens = await this.google.exchangeCode(input.code);
    // Google sends the refresh token on the first consent only (prompt=
    // consent asks for it every time, but be safe): keep the one we have.
    const refreshToken =
      tokens.refreshToken ??
      (await this.connections.findByUserId(user.id))?.refreshToken ??
      null;
    if (!refreshToken) {
      throw new GoogleApiError(
        'Google did not return a refresh token. Remove Remy under Google Account → Security → Third-party access, then connect again.',
      );
    }

    let email: string | null = null;
    try {
      email = await this.google.fetchEmail(tokens.accessToken);
    } catch (error) {
      this.logger.warn(
        `Connected without the account e-mail: ${(error as Error)?.message ?? error}`,
      );
    }

    await this.connections.save({
      userId: user.id,
      email,
      refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
    });
    await this.notifier
      .connected({ chatId: user.telegramUserId, email })
      .catch((error: unknown) =>
        this.logger.warn(`Could not confirm in chat: ${String(error)}`),
      );
    return { userId: user.id, email };
  }
}
