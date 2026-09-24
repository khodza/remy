import { Injectable } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { EnsureUserUsecase } from '@usecases/user/ensure-user';
import {
  DisconnectGoogleUsecase,
  GetGoogleStatusUsecase,
  StartGoogleConnectUsecase,
} from '@usecases/integrations/google-calendar';
import { getEnv } from '@common/config';
import { escapeHtml } from '../html';
import { toEnsureUserInput } from '../user-input';

/**
 * /connect — Google Calendar from the chat: the consent link as a URL
 * button when the server is configured, the status once connected,
 * "/connect off" to disconnect. Picking calendars is done in the Mini App
 * (Settings) or with PATCH /integrations/google.
 */
@Injectable()
export class ConnectCommandHandler {
  constructor(
    private readonly ensureUser: EnsureUserUsecase,
    private readonly getStatus: GetGoogleStatusUsecase,
    private readonly startConnect: StartGoogleConnectUsecase,
    private readonly disconnect: DisconnectGoogleUsecase,
  ) {}

  public async handleConnect(ctx: Context): Promise<void> {
    if (ctx.from === undefined) return;
    try {
      const user = await this.ensureUser.execute(toEnsureUserInput(ctx.from));
      const arg = (ctx.match ?? '').toString().trim().toLowerCase();
      if (arg === 'off' || arg === 'disconnect') {
        await this.disconnect.execute({ userId: user.id });
        await ctx.reply(
          '📅 Google Calendar disconnected. Remy forgot the tokens; the brief no longer lists your events.',
        );
        return;
      }

      const status = await this.getStatus.execute({ userId: user.id });
      if (!status.configured) {
        await ctx.reply(
          '📅 Google Calendar is not set up on this server yet.\n\nThe owner adds GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URL (see the README, “Google Calendar”), then /connect shows a link here.',
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      const lines: string[] = [];
      if (status.connected) {
        lines.push(
          `📅 <b>Google Calendar: connected</b>${status.email ? ` as ${escapeHtml(status.email)}` : ''}`,
        );
        if (status.calendars) {
          const on = status.calendars.filter((c) => c.selected);
          lines.push(
            '',
            `In your brief: ${on.length > 0 ? on.map((c) => escapeHtml(c.summary)).join(', ') : 'nothing selected'}`,
          );
          const off = status.calendars.filter((c) => !c.selected);
          if (off.length > 0) {
            lines.push(
              `Not shown: ${off.map((c) => escapeHtml(c.summary)).join(', ')}`,
            );
          }
        } else {
          lines.push(
            '',
            '⚠️ Google did not answer just now; try /today later.',
          );
        }
        lines.push(
          '',
          "Today's events appear in the morning brief and /today. Pick calendars in the app; <code>/connect off</code> disconnects.",
        );
        const appUrl = getEnv().MINI_APP_URL;
        if (appUrl) {
          const url = new URL(appUrl);
          url.searchParams.set('screen', 'settings');
          keyboard.webApp('⚙️ Calendars in the app', url.toString());
        }
      } else {
        const { url } = await this.startConnect.execute({ userId: user.id });
        lines.push(
          '📅 <b>Connect Google Calendar</b>',
          '',
          "Remy reads your events (read-only) and lists the day's events in the morning brief and /today.",
          '',
          'The link opens in your browser and is valid for 10 minutes.',
        );
        keyboard.url('🔗 Connect Google Calendar', url);
      }
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...(keyboard.inline_keyboard.length > 0
          ? { reply_markup: keyboard }
          : {}),
      });
    } catch (error) {
      console.error('Failed to handle /connect:', error);
      await ctx.reply(
        '❌ Could not load the Google Calendar status. Try again in a minute.',
      );
    }
  }
}
