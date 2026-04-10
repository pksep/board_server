import { DynamicModule, Type } from '@nestjs/common';
import { UsersModule } from 'src/modules/users/users.module';
import { AuthModule } from 'src/modules/auth/auth.module';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import configFactory, { ConfigConstains } from './env.config';
import { getEnvFilePaths } from './env-paths';

import { S3Module } from 'src/modules/s3/s3.module';
import { redisStore } from 'cache-manager-redis-yet';
import { ProjectsModule } from 'src/modules/projects/projects.module';
import { TagsModule } from 'src/modules/tags/tags.module';
import { BoardsModule } from 'src/modules/boards/boards.module';
import { ColumnsModule } from 'src/modules/columns/columns.module';
import { TasksModule } from 'src/modules/tasks/tasks.module';
import { WsModule } from 'src/modules/ws/ws.module';

export const getCoreModules = (): (
  | DynamicModule
  | Promise<DynamicModule>
)[] => [
  DevtoolsModule.register({
    http: false
  }),

  ConfigModule.forRoot({
    envFilePath: getEnvFilePaths(),
    isGlobal: true,
    cache: true,
    load: [configFactory]
  }),

  ServeStaticModule.forRoot({
    rootPath: join(__dirname, '..', '..', 'static'),
    serveRoot: '/static',
    exclude: ['/api/(.*)']
  }),

  CacheModule.registerAsync({
    isGlobal: true,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (configService: ConfigService) => {
      const url = configService.get<string>(ConfigConstains.redisUrl);

      const store = await redisStore({
        url,
        ttl: 70 * 1000
      });

      const client = store.client;

      client.on('error', err => {
        console.error('Redis Client Error', err);
      });
      client.on('connect', () => console.log('Redis client is connect'));
      client.on('reconnecting', () =>
        console.log('Redis client is reconnecting')
      );
      client.on('ready', () => console.log('Redis client is ready'));

      return {
        store
      };
    }
  }),

  BullModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => {
      const url = configService.get<string>(ConfigConstains.redisUrl);

      return {
        connection: {
          url
        }
      };
    }
  }),

  BullBoardModule.forRoot({
    route: '/queues',
    adapter: ExpressAdapter
  }),

  EventEmitterModule.forRoot(),
  S3Module.forRootAsync()
];

export const getAppModule = (): Type<any>[] => [
  AuthModule,
  UsersModule,
  ProjectsModule,
  TagsModule,
  BoardsModule,
  ColumnsModule,
  TasksModule,
  WsModule
];
