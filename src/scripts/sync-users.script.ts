/**
 * Скрипт первичной синхронизации пользователей из ERP.
 *
 * Использование:
 *   npm run sync:users -- --url=http://erp-api.local/api/users/list
 *
 * Флаги:
 *   --url    URL для получения списка пользователей (обязательный)
 *   --token  Bearer-токен для авторизации (опционально)
 *   --dry    Только показать что будет сделано, без записи в БД
 */
import { NestFactory } from '@nestjs/core';
import { Module, Logger } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule } from '@nestjs/config';
import { getSequelizeConfig } from 'src/configs/postgres.config';
import { User } from 'src/modules/users/model/users.model';
import { LoggerModule } from 'src/modules/logger/logger.module';

interface ErpUser {
  id: number;
  initial: string;
  tabel: string;
  login: string;
  ban: boolean;
  image: string | null;
}

@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule,
    SequelizeModule.forRootAsync(getSequelizeConfig({})),
    SequelizeModule.forFeature([User])
  ]
})
class SyncModule {}

async function main() {
  const logger = new Logger('SyncUsers');

  // Парсинг аргументов
  const args = process.argv.slice(2);
  const urlArg = args.find(a => a.startsWith('--url='));
  const tokenArg = args.find(a => a.startsWith('--token='));
  const dryRun = args.includes('--dry');

  if (!urlArg) {
    logger.error(
      'Укажите URL: npm run sync:users -- --url=http://erp-api/api/users/list'
    );
    process.exit(1);
  }

  const url = urlArg.split('=').slice(1).join('=');
  const token = tokenArg ? tokenArg.split('=').slice(1).join('=') : null;

  logger.log(`Синхронизация пользователей из: ${url}`);
  if (dryRun) logger.warn('DRY RUN — изменения в БД не будут сохранены');

  // Запрос пользователей
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let erpUsers: ErpUser[];
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    // ERP может вернуть массив напрямую или в поле rows/data
    erpUsers = Array.isArray(data) ? data : data.rows || data.data || [];
    logger.log(`Получено ${erpUsers.length} пользователей из ERP`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Не удалось получить пользователей: ${message}`);
    process.exit(1);
  }

  if (erpUsers.length === 0) {
    logger.warn('Нет пользователей для синхронизации');
    process.exit(0);
  }

  // Подключение к БД
  const app = await NestFactory.createApplicationContext(SyncModule);
  const userRepo = app.get('UserRepository') as typeof User;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const erp of erpUsers) {
    const erpId = String(erp.id);
    const serviceNumber = erp.tabel || erpId;

    // Ищем по erpId или по serviceNumber
    let user = await userRepo.findOne({ where: { erpId } });
    if (!user) {
      user = await userRepo.findOne({ where: { serviceNumber } });
    }

    if (user) {
      // Обновляем
      let changed = false;
      if (!user.erpId) {
        user.erpId = erpId;
        changed = true;
      }
      if (erp.initial && user.initial !== erp.initial) {
        user.initial = erp.initial;
        changed = true;
      }
      if (erp.login && user.login !== erp.login) {
        user.login = erp.login;
        changed = true;
      }
      if (serviceNumber && user.serviceNumber !== serviceNumber) {
        user.serviceNumber = serviceNumber;
        changed = true;
      }
      if (erp.image !== undefined && user.image !== erp.image) {
        user.image = erp.image;
        changed = true;
      }
      if (erp.ban !== undefined && user.ban !== erp.ban) {
        user.ban = erp.ban;
        changed = true;
      }

      if (changed) {
        if (!dryRun) await user.save();
        updated++;
        logger.log(
          `  UPDATED: [${erpId}] ${erp.initial || erp.login} (${serviceNumber})`
        );
      } else {
        skipped++;
      }
    } else {
      // Создаём
      if (!dryRun) {
        await userRepo.create({
          erpId,
          initial: erp.initial || erp.login || '',
          login: erp.login || '',
          serviceNumber,
          image: erp.image || null,
          ban: erp.ban || false
        } as any);
      }
      created++;
      logger.log(
        `  CREATED: [${erpId}] ${erp.initial || erp.login} (${serviceNumber})`
      );
    }
  }

  logger.log('');
  logger.log('═══════════════════════════════════════');
  logger.log(`  Создано:    ${created}`);
  logger.log(`  Обновлено:  ${updated}`);
  logger.log(`  Без изменений: ${skipped}`);
  logger.log('═══════════════════════════════════════');
  if (dryRun) logger.warn('DRY RUN — ничего не записано в БД');

  await app.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
