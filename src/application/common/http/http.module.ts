import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { APP_FILTER } from '@nestjs/core';
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

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => {
        const secret = process.env['JWT_SECRET'];
        if (!secret) {
          throw new Error('JWT_SECRET is not configured');
        }
        const expiresIn = (process.env['JWT_EXPIRES_IN'] ?? '15m') as unknown as number;
        return { secret, signOptions: { expiresIn } };
      },
    }),
    TaskModule,
    UserModule,
    OpenAIModule,
  ],
  controllers: [
    AuthController,
    UserController,
    TaskController,
    AiController,
    HealthController,
  ],
  providers: [
    AuthService,
    InitDataGuard,
    JwtAuthGuard,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class HttpModule {}
