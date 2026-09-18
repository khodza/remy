import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { GetSettingsUsecase, UpdateSettingsUsecase } from '@usecases/settings';
import { UpdateSettingsRequest, type Settings } from '@contract/remy-contract';
import type { UserSettingsPatch } from '@domain/user';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import type { AuthContext } from '../types';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly getSettings: GetSettingsUsecase,
    private readonly updateSettings: UpdateSettingsUsecase,
  ) {}

  @Get()
  async get(@CurrentUser() auth: AuthContext): Promise<Settings> {
    return this.getSettings.execute({ userId: auth.userId });
  }

  @Patch()
  async patch(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateSettingsRequest))
    dto: UpdateSettingsRequest,
  ): Promise<Settings> {
    // zod's `.partial()` types absent keys as `T | undefined`; drop them so
    // the domain patch only carries what the client actually sent.
    const patch = JSON.parse(JSON.stringify(dto)) as UserSettingsPatch;
    return this.updateSettings.execute({ userId: auth.userId, patch });
  }
}
