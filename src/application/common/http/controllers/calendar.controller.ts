import {
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ManageCalendarFeedUsecase,
  RenderCalendarFeedUsecase,
  type CalendarFeedState,
} from '@usecases/data';
import type { CalendarFeed } from '@contract/remy-contract';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthContext } from '../types';

function toWire(state: CalendarFeedState): CalendarFeed {
  return {
    enabled: state.enabled,
    path: state.token ? `/calendar/${state.token}.ics` : null,
  };
}

/**
 * The private calendar subscription. Managing it needs the owner's JWT;
 * the .ics itself is fetched by Google / Apple servers, so the secret in
 * its path is the only credential (replace it to cut off an old link).
 */
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly manage: ManageCalendarFeedUsecase,
    private readonly render: RenderCalendarFeedUsecase,
  ) {}

  // Declared before ':file' so "feed" is never read as a token.
  @Get('feed')
  @UseGuards(JwtAuthGuard)
  async get(@CurrentUser() auth: AuthContext): Promise<CalendarFeed> {
    return toWire(
      await this.manage.execute({ userId: auth.userId, action: 'get' }),
    );
  }

  @Post('feed')
  @UseGuards(JwtAuthGuard)
  async enable(@CurrentUser() auth: AuthContext): Promise<CalendarFeed> {
    return toWire(
      await this.manage.execute({ userId: auth.userId, action: 'enable' }),
    );
  }

  @Delete('feed')
  @UseGuards(JwtAuthGuard)
  async disable(@CurrentUser() auth: AuthContext): Promise<CalendarFeed> {
    return toWire(
      await this.manage.execute({ userId: auth.userId, action: 'disable' }),
    );
  }

  @Get(':file')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="remy.ics"')
  @Header('Cache-Control', 'private, max-age=300')
  async ics(@Param('file') file: string): Promise<string> {
    const ics = file.endsWith('.ics')
      ? await this.render.execute({ token: file.slice(0, -'.ics'.length) })
      : null;
    // One answer for malformed, replaced and disabled links.
    if (ics === null) throw new NotFoundException('Calendar not found');
    return ics;
  }
}
