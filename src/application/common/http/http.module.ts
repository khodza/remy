import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TaskModule } from '../task/task.module';
import { UserModule } from '../user/user.module';
import { OpenAIModule } from '../openai/openai.module';
import { AuthService } from './services/auth.service';
import { InitDataGuard } from './guards/init-data.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { AuthController } from './controllers/auth.controller';
import { UserController } from './controllers/user.controller';
import { TaskController } from './controllers/task.controller';
import { AiController } from './controllers/ai.controller';
import { HealthController } from './controllers/health.controller';
import { SettingsController } from './controllers/settings.controller';
import { CategoryController } from './controllers/category.controller';
import { CalendarController } from './controllers/calendar.controller';
import { ExportController } from './controllers/export.controller';
import { ListController } from './controllers/list.controller';
import { DataModule } from '../data/data.module';
import { getEnv } from '@common/config';
import { GetSettingsUsecase, UpdateSettingsUsecase } from '@usecases/settings';
import {
  CreateCategoryUsecase,
  DeleteCategoryUsecase,
  ListCategoriesUsecase,
  UpdateCategoryUsecase,
} from '@usecases/category';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => {
        const env = getEnv();
        return {
          secret: env.JWT_SECRET,
          // jsonwebtoken accepts "15m"-style strings; the type says number.
          signOptions: { expiresIn: env.JWT_EXPIRES_IN as unknown as number },
        };
      },
    }),
    // Single-owner API: a generous global ceiling; paid endpoints (create,
    // voice, parse) carry tighter per-route limits.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    TaskModule,
    UserModule,
    OpenAIModule,
    DataModule,
  ],
  controllers: [
    AuthController,
    UserController,
    TaskController,
    AiController,
    SettingsController,
    CategoryController,
    CalendarController,
    ExportController,
    ListController,
    HealthController,
  ],
  providers: [
    AuthService,
    GetSettingsUsecase,
    UpdateSettingsUsecase,
    ListCategoriesUsecase,
    CreateCategoryUsecase,
    UpdateCategoryUsecase,
    DeleteCategoryUsecase,
    InitDataGuard,
    JwtAuthGuard,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class HttpModule {}
