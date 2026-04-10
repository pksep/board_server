import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import configFactory, { ConfigConstains } from './configs/env.config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
import { Sequelize } from 'sequelize';
import { isDatabaseEmpty } from './scripts/is-database-empty';
import { getConnectionToken } from '@nestjs/sequelize';
import { LoggerService } from './modules/logger/logger.service';
import { AllExceptionsFilter } from './modules/logger/filters/all-exceptions.filter';

(async () => {
  const app = await NestFactory.create(AppModule, {
    snapshot: false,
    bufferLogs: true
  });

  const configF = configFactory();

  // Допустимые домены
  const allowedOrigins =
    [configF.allowedOrigin, configF.erpClientOfflineHost]
      .filter(Boolean)
      .join(',')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean) ?? [];

  // Флаг на допустимость всех доменов
  const isAllowAll = allowedOrigins.includes('*');

  app.use(cookieParser());

  app.enableCors({
    exposedHeaders: ['Content-Encoding'],
    origin: (origin, callback) => {
      if (isAllowAll) {
        callback(null, true);
        return;
      }

      if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
        callback(null, true);
        return;
      }

      // Разрешаем только известные домены
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Все остальные отклоняем
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  });
  app.setGlobalPrefix('api');

  const logger = app.get(LoggerService);
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true
    })
  );

  const configService = app.get(ConfigService);
  const portRun = configService.get(ConfigConstains.port);
  const applicationType = configService.get(ConfigConstains.applicationType);

  app.useGlobalPipes(new ValidationPipe());

  const config = new DocumentBuilder()
    .setTitle('СЭП:Умный Пресс')
    .setDescription(
      'Документация взаимодействия с APi приложения Системы атоматизации производства СЭП:Умный Пресс'
    )
    .setVersion('0.0.2')
    .addCookieAuth(
      'access_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description: 'Enter JWT token from cookie'
      },
      'cookie-auth'
    )
    .addTag('NPO')
    .addSecurityRequirements('cookie-auth')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/api/docs', app, document, {
    swaggerOptions: {
      withCredentials: true,
      persistAuthorization: true,
      requestInterceptor: req => {
        req.credentials = 'include';
        return req;
      }
    }
  });

  const sequelize = app.get(getConnectionToken()) as Sequelize;

  const empty = await isDatabaseEmpty(sequelize);

  if (empty) {
    await sequelize.sync({ force: false, alter: false });
  }

  await app.listen(portRun, () => {
    console.info(`${applicationType}... Server running on port: ${portRun}`);
  });
})();
