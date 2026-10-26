import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConfigConstains } from 'src/configs/env.config';
import type { IUserDirectoryRequest } from '../users/interfaces/user-directory-request.interface';
import { ErpTimeReportPermissionsSchema } from './dto/erp-time-report-permissions.dto';

@Injectable()
export class TimeReportPermissionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** Проверяет актуальную матрицу той же ERP-сессии, которую подтвердил общий guard. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IUserDirectoryRequest>();
    const token = request.cookies?.access_token;
    const base = this.config.get<string>(ConfigConstains.erpApiUrl);

    // Локальный board_token и dev fallback не заменяют разрешение роли ERP.
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException(
        'Для отчёта нужна действующая сессия ERP'
      );
    }
    if (!base) {
      throw new ServiceUnavailableException(
        'Не удалось проверить доступ к учёту времени'
      );
    }

    const normalized = base.replace(/\/+$/, '');
    const apiBase = normalized.endsWith('/api')
      ? normalized
      : `${normalized}/api`;
    let data: unknown;

    try {
      const response = await axios.get<unknown>(`${apiBase}/authorization/me`, {
        headers: {
          Cookie: `access_token=${encodeURIComponent(token)}`,
          compress: 'no-compress'
        },
        timeout: 5000,
        maxRedirects: 0,
        proxy: false
      });
      data = response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new UnauthorizedException('Сессия ERP истекла');
      }
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new ForbiddenException('Нет доступа к учёту времени');
      }

      throw new ServiceUnavailableException(
        'Не удалось проверить доступ к учёту времени'
      );
    }

    const parsed = ErpTimeReportPermissionsSchema.safeParse(data);
    if (!parsed.success) {
      throw new ServiceUnavailableException(
        'Не удалось проверить доступ к учёту времени'
      );
    }

    const requirements = [
      { resource: 'general.time-tracking', action: 'view' },
      { resource: 'general.projects', action: 'view' }
    ];
    const allowed = requirements.every(requirement =>
      parsed.data.permissions.some(
        permission =>
          permission.resource_code === requirement.resource &&
          permission.action === requirement.action
      )
    );

    if (!allowed) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Для отчёта нужны права просмотра учёта времени и проектов',
        requiredPermissions: requirements,
        requirementMode: 'allOf'
      });
    }

    return true;
  }
}
