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
import configFactory from 'src/configs/env.config';
import { getEnvFilePaths } from 'src/configs/env-paths';
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
    ConfigModule.forRoot({
      envFilePath: getEnvFilePaths(),
      isGlobal: true,
      cache: true,
      load: [configFactory]
    }),
    LoggerModule,
    SequelizeModule.forRootAsync(getSequelizeConfig({ logging: false })),
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
  const boardUsers = await userRepo.findAll();
  const byErpId = new Map(
    boardUsers.filter(user => user.erpId).map(user => [user.erpId, user])
  );
  const byServiceNumber = new Map(
    boardUsers.map(user => [user.serviceNumber, user])
  );
  const erpServiceNumbers = new Map<string, string>();
  const ambiguousServiceNumbers = new Set<string>();
  for (const erp of erpUsers) {
    const serviceNumber = erp.tabel || String(erp.id);
    const previousId = erpServiceNumbers.get(serviceNumber);
    if (previousId && previousId !== String(erp.id)) {
      ambiguousServiceNumbers.add(serviceNumber);
    }
    erpServiceNumbers.set(serviceNumber, String(erp.id));
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const erp of erpUsers) {
    const erpId = String(erp.id);
    const serviceNumber = erp.tabel || erpId;

    if (ambiguousServiceNumbers.has(serviceNumber)) {
      logger.error(
        `CONFLICT: несколько ERP ID с табельным номером ${serviceNumber}`
      );
      conflicts++;
      continue;
    }
    const userById = byErpId.get(erpId);
    const userByNumber = byServiceNumber.get(serviceNumber);
    if (userById && userByNumber && userById.id !== userByNumber.id) {
      logger.error(
        `CONFLICT: erpId=${erpId} и serviceNumber=${serviceNumber} принадлежат разным Board ID`
      );
      conflicts++;
      continue;
    }
    const user = userById || userByNumber;

    if (user) {
      // Обновляем
      let changed = false;
      const oldErpId = user.erpId;
      const oldServiceNumber = user.serviceNumber;
      if (user.erpId !== erpId) {
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

      if (changed || user.ban) {
        if (!dryRun) {
          await userRepo.sequelize.transaction(async transaction => {
            await user.save({ transaction });
            // Повторная сверка исправляет назначения и для уже архивных сотрудников.
            if (user.ban) {
              await userRepo.sequelize.query(
                'DELETE FROM "task_assignees" WHERE "user_id" = :userId',
                { replacements: { userId: user.id }, transaction }
              );
            }
          });
        }
        updated++;
        if (!dryRun) {
          if (oldErpId) byErpId.delete(oldErpId);
          byErpId.set(erpId, user);
          if (oldServiceNumber !== serviceNumber) {
            byServiceNumber.delete(oldServiceNumber);
            byServiceNumber.set(serviceNumber, user);
          }
        }
        logger.log(
          `  UPDATED: [${erpId}] ${erp.initial || erp.login} (${serviceNumber})`
        );
      } else {
        skipped++;
      }
    } else {
      // Создаём
      if (!dryRun) {
        const createdUser = await userRepo.create({
          erpId,
          initial: erp.initial || erp.login || '',
          login: erp.login || '',
          serviceNumber,
          image: erp.image || null,
          ban: erp.ban || false
        } as any);
        byErpId.set(erpId, createdUser);
        byServiceNumber.set(serviceNumber, createdUser);
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
  logger.log(`  Конфликты:  ${conflicts}`);
  logger.log('═══════════════════════════════════════');
  if (dryRun) logger.warn('DRY RUN — ничего не записано в БД');

  await app.close();
  process.exit(conflicts > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
