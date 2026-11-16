import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { assertErpPermissions } from '../auth/erp-permissions';

@Injectable()
export class StandaloneTimePermissionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** Независимые записи требуют права учёта времени, без доступа к проектам. */
  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const requirements = [
      { resource: 'general.time-tracking', action: 'view' }
    ];

    if (request.method === 'POST') {
      requirements.push({
        resource: 'general.time-tracking',
        action: 'create'
      });
    }

    return assertErpPermissions(this.config, request, {
      requirements,
      mode: 'allOf',
      sessionMessage: 'Для учёта времени нужна действующая сессия ERP',
      unavailableMessage: 'Не удалось проверить доступ к учёту времени',
      deniedMessage: 'Нет доступа к учёту времени',
      requiredMessage: 'Недостаточно прав для записи времени'
    });
  }
}
