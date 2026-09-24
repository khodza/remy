import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Domain } from '@common/tokens';
import { getEnv } from '@common/config';
import {
  GOOGLE_CONNECTIONS_COLLECTION,
  GoogleConnectionRepositoryImpl,
  GoogleConnectionSchema,
} from '@infra/mongodb/google-connection';
import { GoogleCalendarGatewayImpl } from '@infra/google/google-calendar.client';
import { TokenCipher } from '@infra/google/token-cipher';
import { ConnectStateSignerImpl } from '@infra/google/connect-state.signer';
import { GoogleConnectionNotifierImpl } from '@infra/bot/notification/google-connection.notifier';
import { ConnectCommandHandler } from '@infra/bot/handlers/connect.handler';
import {
  CompleteGoogleConnectUsecase,
  DisconnectGoogleUsecase,
  GetGoogleStatusUsecase,
  SelectGoogleCalendarsUsecase,
  StartGoogleConnectUsecase,
  TodayCalendarEventsUsecase,
} from '@usecases/integrations/google-calendar';
import { UserModule } from '../user/user.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * Google Calendar, read-only (plan 4.5). Global so the morning brief's
 * optional CalendarEventsSource resolves wherever DigestBuilder lives and
 * the HTTP controller can sit with the other controllers.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GOOGLE_CONNECTIONS_COLLECTION, schema: GoogleConnectionSchema },
    ]),
    UserModule,
    NotificationModule,
  ],
  providers: [
    {
      provide: TokenCipher,
      useFactory: () => {
        const env = getEnv();
        return new TokenCipher(env.GOOGLE_TOKEN_KEY ?? env.JWT_SECRET);
      },
    },
    {
      provide: Domain.Integrations.ConnectStateSigner,
      useFactory: () => {
        const env = getEnv();
        return new ConnectStateSignerImpl(
          env.GOOGLE_TOKEN_KEY ?? env.JWT_SECRET,
        );
      },
    },
    {
      provide: Domain.Integrations.GoogleCalendarGateway,
      useFactory: () => new GoogleCalendarGatewayImpl(),
    },
    {
      provide: Domain.Integrations.GoogleConnectionRepository,
      useClass: GoogleConnectionRepositoryImpl,
    },
    {
      provide: Domain.Integrations.GoogleConnectionNotifier,
      useClass: GoogleConnectionNotifierImpl,
    },
    {
      provide: Domain.Integrations.CalendarEventsSource,
      useClass: TodayCalendarEventsUsecase,
    },
    GetGoogleStatusUsecase,
    StartGoogleConnectUsecase,
    CompleteGoogleConnectUsecase,
    DisconnectGoogleUsecase,
    SelectGoogleCalendarsUsecase,
    ConnectCommandHandler,
  ],
  exports: [
    Domain.Integrations.CalendarEventsSource,
    Domain.Integrations.GoogleCalendarGateway,
    Domain.Integrations.GoogleConnectionRepository,
    GetGoogleStatusUsecase,
    StartGoogleConnectUsecase,
    CompleteGoogleConnectUsecase,
    DisconnectGoogleUsecase,
    SelectGoogleCalendarsUsecase,
    ConnectCommandHandler,
  ],
})
export class GoogleCalendarModule {}
