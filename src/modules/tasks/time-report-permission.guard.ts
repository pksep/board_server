import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertErpPermissions } from '../auth/erp-permissions';
import type { ErpPermissionPolicy } from '../auth/interfaces/erp-permission-policy.interface';

const TIME_REPORT_POLICY: ErpPermissionPolicy = {
  requirements: [
    { resource: 'general.time-tracking', action: 'view' },
    { resource: 'general.projects', action: 'view' }
  ],
  mode: 'allOf',
  sessionMessage: 'Для отчёта нужна действующая сессия ERP',
  unavailableMessage: 'Не удалось проверить доступ к учёту времени',
  deniedMessage: 'Нет доступа к учёту времени',
  requiredMessage: 'Для отчёта нужны права просмотра учёта времени и проектов'
};

@Injectable()
export class TimeReportPermissionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  /** Сохраняет требование обоих разрешений отчёта при общем обмене с ERP. */
  canActivate(context: ExecutionContext): Promise<boolean> {
    return assertErpPermissions(
      this.config,
      context.switchToHttp().getRequest(),
      TIME_REPORT_POLICY
    );
  }

  /** ERP проверяет делегированный доступ ИИ по тем же актуальным правам отчёта. */
  async assertMcpAccess(token: string): Promise<void> {
    if (!token) {
      throw new UnauthorizedException('Для отчёта нужен действующий MCP token');
    }

    await assertErpPermissions(this.config, {}, TIME_REPORT_POLICY, token);
  }
}
