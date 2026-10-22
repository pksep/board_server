import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConfigConstains } from 'src/configs/env.config';
import { ErpUserDirectorySchema } from './dto/erp-user-directory.dto';
import { UserSyncConsumer } from './user-sync.consumer';
import type { IUserDirectoryRequest } from './interfaces/user-directory-request.interface';

@Injectable()
export class UserDirectoryService {
  private readonly logger = new Logger(UserDirectoryService.name);

  private refreshedAt = -Infinity;

  private pending: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly userSync: UserSyncConsumer
  ) {}

  /** Дополняет справочник перед его чтением, не требуя входа каждого сотрудника. */
  async ensureMissingUsers(request: IUserDirectoryRequest): Promise<void> {
    const cookie = request.cookies?.access_token;
    const authorization = request.headers?.authorization;
    const token =
      typeof cookie === 'string' && cookie
        ? cookie
        : typeof authorization === 'string'
          ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
          : undefined;
    const base = this.config.get<string>(ConfigConstains.erpApiUrl);

    // Локальный Board-токен не является сессией ERP и не должен передаваться туда.
    if (!token || !base || Date.now() - this.refreshedAt < 60000) return;

    if (!this.pending) {
      this.pending = this.refresh(base, token)
        .then(() => {
          this.refreshedAt = Date.now();
        })
        .catch(() => {
          // Сбой ERP не скрывает уже известных сотрудников. Следующее чтение повторит сверку.
          this.logger.warn(
            'ERP user directory refresh failed; keeping existing Board users'
          );
        })
        .finally(() => {
          this.pending = null;
        });
    }

    await this.pending;
  }

  /** Читает активных сотрудников по текущей сессии и использует штатное сопоставление. */
  private async refresh(base: string, token: string): Promise<void> {
    const normalized = base.replace(/\/+$/, '');
    const apiBase = normalized.endsWith('/api')
      ? normalized
      : `${normalized}/api`;
    const response = await axios.get<unknown>(
      `${apiBase}/users/list/true/false`,
      {
        headers: {
          Cookie: `access_token=${encodeURIComponent(token)}`,
          compress: 'no-compress'
        },
        timeout: 5000,
        maxRedirects: 0,
        proxy: false
      }
    );
    const users = ErpUserDirectorySchema.parse(response.data);
    const ids = new Set<string>();
    const serviceNumbers = new Set<string>();

    // Проверяем весь ответ до первой записи: неоднозначный снимок нельзя частично применять.
    for (const user of users) {
      const id = String(user.id);

      if (ids.has(id) || serviceNumbers.has(user.tabel)) {
        throw new Error('Ambiguous ERP user directory');
      }

      ids.add(id);
      serviceNumbers.add(user.tabel);
    }

    for (const user of users) {
      if (!user.ban) await this.userSync.synchronizeUser(user, true);
    }
  }
}
