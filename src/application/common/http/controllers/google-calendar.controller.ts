import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CompleteGoogleConnectUsecase,
  DisconnectGoogleUsecase,
  GetGoogleStatusUsecase,
  SelectGoogleCalendarsUsecase,
  StartGoogleConnectUsecase,
} from '@usecases/integrations/google-calendar';
import {
  GoogleApiError,
  GoogleAuthError,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  InvalidConnectStateError,
} from '@domain/integrations/google-calendar';
import {
  SelectGoogleCalendarsRequest,
  type GoogleConnectResult,
  type GoogleStatus,
} from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

/**
 * Google Calendar, read-only. Everything but the callback needs the owner's
 * JWT; the callback is where Google sends the owner's browser, so its only
 * credential is the signed `state` the connect step issued.
 */
@Controller('integrations/google')
export class GoogleCalendarController {
  constructor(
    private readonly getStatus: GetGoogleStatusUsecase,
    private readonly startConnect: StartGoogleConnectUsecase,
    private readonly completeConnect: CompleteGoogleConnectUsecase,
    private readonly disconnect: DisconnectGoogleUsecase,
    private readonly selectCalendars: SelectGoogleCalendarsUsecase,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@CurrentUser() auth: AuthContext): Promise<GoogleStatus> {
    return this.getStatus.execute({ userId: auth.userId });
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  async connect(
    @CurrentUser() auth: AuthContext,
  ): Promise<GoogleConnectResult> {
    return translate(() => this.startConnect.execute({ userId: auth.userId }));
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    if (error || !code || !state) {
      // The owner pressed Cancel on Google's screen, or the link is broken.
      res
        .status(400)
        .send(
          page(
            'Not connected',
            error === 'access_denied'
              ? 'You cancelled on Google’s side. Nothing was changed; run /connect in Remy to try again.'
              : 'This link is incomplete. Run /connect in Remy to get a fresh one.',
          ),
        );
      return;
    }
    try {
      const result = await this.completeConnect.execute({ code, state });
      res
        .status(200)
        .send(
          page(
            'Connected',
            `Google Calendar${result.email ? ` (${escape(result.email)})` : ''} is connected to Remy. You can close this page.`,
          ),
        );
    } catch (err) {
      if (err instanceof InvalidConnectStateError) {
        res
          .status(400)
          .send(
            page(
              'Link expired',
              'This connect link is invalid or older than 10 minutes. Run /connect in Remy to get a fresh one.',
            ),
          );
        return;
      }
      if (err instanceof GoogleNotConfiguredError) {
        res
          .status(409)
          .send(
            page(
              'Not configured',
              'Google Calendar is not set up on this server.',
            ),
          );
        return;
      }
      if (err instanceof GoogleAuthError || err instanceof GoogleApiError) {
        res
          .status(502)
          .send(
            page(
              'Google did not answer',
              `Google refused or did not answer (${escape(err.message)}). Run /connect in Remy to try again.`,
            ),
          );
        return;
      }
      throw err;
    }
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async remove(@CurrentUser() auth: AuthContext): Promise<GoogleStatus> {
    return this.disconnect.execute({ userId: auth.userId });
  }

  @Patch()
  @UseGuards(JwtAuthGuard)
  async select(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(SelectGoogleCalendarsRequest))
    dto: SelectGoogleCalendarsRequest,
  ): Promise<GoogleStatus> {
    return translate(() =>
      this.selectCalendars.execute({
        userId: auth.userId,
        calendarIds: dto.calendarIds,
      }),
    );
  }
}

/** Domain errors of this feature → HTTP, without touching the global filter. */
async function translate<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoogleNotConfiguredError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof GoogleNotConnectedError) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof InvalidConnectStateError) {
      throw new BadRequestException(error.message);
    }
    if (error instanceof GoogleAuthError) {
      throw new BadGatewayException(
        'Google no longer accepts the connection. Disconnect and connect again.',
      );
    }
    if (error instanceof GoogleApiError) {
      throw new BadGatewayException(
        'Google did not answer. Try again in a minute.',
      );
    }
    throw error;
  }
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A tiny self-contained page for the browser tab Google redirected to. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Remy · ${escape(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.25rem;color:#1c1c1e;background:#fafaf7;line-height:1.5}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;color:#4a4a4f}</style>
</head><body><h1>${escape(title)}</h1><p>${body}</p></body></html>
`;
}
