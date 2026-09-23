import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { InitDataGuard } from '../guards/init-data.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthContext } from '../types';
import { AuthService, type AuthResult } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram')
  @UseGuards(InitDataGuard)
  async exchange(@Req() req: Request): Promise<AuthResult> {
    const initDataRaw = req.initDataRaw;
    if (!initDataRaw) {
      throw new Error('initDataRaw missing after InitDataGuard');
    }
    return this.authService.exchange(initDataRaw);
  }

  /** A still-valid JWT for a fresh one (same session, capped at 7 days). */
  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  async refresh(@CurrentUser() auth: AuthContext): Promise<AuthResult> {
    return this.authService.refresh(auth);
  }
}
