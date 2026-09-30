import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigModule } from '@nestjs/config';
import { User } from '../users/model/users.model';
import { AccessTokenService } from './access-token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessTokenService],
  imports: [
    JwtModule.register({
      // Board-сервер использует СВОЙ ключ для board_token
      secret: process.env.PRIVATE_KEY || 'board_secret_key',
      signOptions: { expiresIn: '24h' }
    }),
    SequelizeModule.forFeature([User]),
    ConfigModule
  ],
  exports: [AuthService, AccessTokenService, JwtModule]
})
export class AuthModule {}
