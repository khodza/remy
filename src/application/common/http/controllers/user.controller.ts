import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Domain } from '@common/tokens';
import type { UserRepository } from '@domain/user';
import { UserNotFoundError } from '@domain/user';
import { UpdateTimezoneUsecase } from '@usecases/user';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthService, type UserDto } from '../services/auth.service';
import { UpdateTimezoneDto } from '../dto/update-timezone.dto';
import type { AuthContext } from '../types';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    @Inject(Domain.User.Repository)
    private readonly userRepository: UserRepository,
    private readonly updateTimezoneUsecase: UpdateTimezoneUsecase,
    private readonly authService: AuthService,
  ) {}

  @Get('me')
  async me(@CurrentUser() auth: AuthContext): Promise<UserDto> {
    const user = await this.userRepository.findById(auth.userId);
    if (!user) {
      throw new UserNotFoundError(`User ${auth.userId} not found`);
    }
    return this.authService.toUserDto(user);
  }

  @Patch('timezone')
  async updateTimezone(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpdateTimezoneDto,
  ): Promise<UserDto> {
    const user = await this.updateTimezoneUsecase.execute({
      userId: auth.userId,
      timezone: dto.timezone,
    });
    return this.authService.toUserDto(user);
  }
}
