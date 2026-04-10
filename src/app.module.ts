import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { APP_GUARD } from '@nestjs/core';
import { AppInitService } from 'src/scripts/app-init.service';
import { getSequelizeConfig } from 'src/configs/postgres.config';
import { getAppModule, getCoreModules } from './configs/modules';
import { OriginMiddleware } from 'src/middleware/origin.middleware';
import { LoggerModule } from './modules/logger/logger.module';
import { RabbitMqModule } from './modules/rabbitmq/rabbitmq.module';
import { TokenAuth } from './modules/auth/jwt-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { User } from './modules/users/model/users.model';

@Module({
  controllers: [],
  providers: [
    AppInitService,
    {
      provide: APP_GUARD,
      useClass: TokenAuth
    }
  ],
  imports: [
    ...getCoreModules(),
    LoggerModule,
    RabbitMqModule,
    SequelizeModule.forFeature([User]),
    SequelizeModule.forRootAsync(getSequelizeConfig({})),
    AuthModule,
    ...getAppModule()
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginMiddleware).forRoutes('*');
  }
}
