import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ConfigConstains } from 'src/configs/env.config';
import type { IUserDirectoryRequest } from '../users/interfaces/user-directory-request.interface';
import type { ErpPermissionPolicy } from './interfaces/erp-permission-policy.interface';
import { ErpPermissionsSchema } from './dto/erp-permissions.dto';

/** Проверяет актуальные права той ERP-сессии, которую подтвердил общий guard. */
export async function assertErpPermissions(
  config: ConfigService,
  request: IUserDirectoryRequest,
  policy: ErpPermissionPolicy
): Promise<true> {
  const token = request.cookies?.access_token;
  const base = config.get<string>(ConfigConstains.erpApiUrl);

  // Общий TokenAuth уже разрешил дубликаты cookie и зафиксировал выбранную личность.
  if (typeof token !== 'string' || !token) {
    throw new UnauthorizedException(policy.sessionMessage);
  }
  if (!base) throw new ServiceUnavailableException(policy.unavailableMessage);

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
      throw new ForbiddenException(policy.deniedMessage);
    }

    throw new ServiceUnavailableException(policy.unavailableMessage);
  }

  const parsed = ErpPermissionsSchema.safeParse(data);
  if (!parsed.success) {
    throw new ServiceUnavailableException(policy.unavailableMessage);
  }

  const matches = policy.requirements.map(requirement =>
    parsed.data.permissions.some(
      permission =>
        permission.resource_code === requirement.resource &&
        permission.action === requirement.action
    )
  );
  const allowed =
    matches.length > 0 &&
    (policy.mode === 'allOf' ? matches.every(Boolean) : matches.some(Boolean));

  if (!allowed) {
    throw new ForbiddenException({
      code: 'PERMISSION_DENIED',
      message: policy.requiredMessage,
      requiredPermissions: policy.requirements,
      requirementMode: policy.mode
    });
  }

  return true;
}
