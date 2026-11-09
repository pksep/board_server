import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertErpPermissions } from '../auth/erp-permissions';

@Injectable()
export class ExecutorPlanningPermissionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** Разрешение производства открывает планирование, но не карточки чужих проектов. */
  canActivate(context: ExecutionContext): Promise<boolean> {
    return assertErpPermissions(
      this.config,
      context.switchToHttp().getRequest(),
      {
        requirements: [
          { resource: 'production.overview', action: 'view' },
          { resource: 'production.tasks', action: 'view' }
        ],
        mode: 'anyOf',
        sessionMessage: 'Для планирования нужна действующая сессия ERP',
        unavailableMessage:
          'Не удалось проверить доступ к планированию производства',
        deniedMessage: 'Нет доступа к планированию производства',
        requiredMessage:
          'Для просмотра загрузки нужно право просмотра производства или ПЗ'
      }
    );
  }
}
