import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModuleAsyncOptions } from '@nestjs/sequelize';
import models from './models';
import { ConfigConstains } from './env.config';
import { URL } from 'url';

export const parseDatabaseUrl = (urlString: string) => {
  const url = new URL(urlString);

  return {
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace('/', '')
  };
};

export const getSequelizeConfig = ({
  logging = true
}): SequelizeModuleAsyncOptions => ({
  useFactory: (configService: ConfigService) => {
    const dbUrl = parseDatabaseUrl(
      configService.get<string>(ConfigConstains.database.url)
    );
    return {
      dialect: 'postgres',
      host: dbUrl.host,
      port: Number(dbUrl.port),
      username: dbUrl.user,
      password: dbUrl.password,
      database: dbUrl.database,
      dialectOptions: {
        connectTimeout: 60000
      },
      logging: !logging
        ? false
        : configService.get<string>(ConfigConstains.applicationType) !== 'test',
      models: models,
      autoLoadModels: false,
      synchronize: true,
      sync: { alter: true },
      pool: {
        max: 50,
        min: 5,
        acquire: 60000,
        idle: 30000,
        evict: 10000,
        maxUses: 30
      },
      retry: {
        max: 0
      }
    };
  },
  inject: [ConfigService],
  imports: [ConfigModule]
});
