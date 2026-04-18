import {
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { InitDataGuard } from '../guards/init-data.guard';
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
}
