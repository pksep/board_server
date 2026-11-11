import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertErpPermissions } from '../auth/erp-permissions';

@Injectable()
export class TimeReportPermissionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** Сохраняет требование обоих разрешений отчёта при общем обмене с ERP. */
  canActivate(context: ExecutionContext): Promise<boolean> {
    return assertErpPermissions(
      this.config,
      context.switchToHttp().getRequest(),
      {
        requirements: [
          { resource: 'general.time-tracking', action: 'view' },
          { resource: 'general.projects', action: 'view' }
        ],
        mode: 'allOf',
        sessionMessage: 'Для отчёта нужна действующая сессия ERP',
        unavailableMessage: 'Не удалось проверить доступ к учёту времени',
        deniedMessage: 'Нет доступа к учёту времени',
        requiredMessage:
          'Для отчёта нужны права просмотра учёта времени и проектов'
      }
    );
  }
}
