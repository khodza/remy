import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Domain } from '@common/tokens';
import { Collections } from '@infra/mongodb';
import { UserSchema } from '@infra/mongodb/user/schema';
import { UserRepositoryImpl } from '@infra/mongodb/user/repository';
import { EnsureUserUsecase, UpdateTimezoneUsecase } from '@usecases/user';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Collections.Users, schema: UserSchema },
    ]),
  ],
  providers: [
    {
      provide: Domain.User.Repository,
      useClass: UserRepositoryImpl,
    },
    EnsureUserUsecase,
    UpdateTimezoneUsecase,
  ],
  exports: [EnsureUserUsecase, UpdateTimezoneUsecase],
})
export class UserModule {}
