import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { IUserDataToken } from './interfaces/interface';

/**
 * Параметровый декоратор для извлечения текущего пользователя из request.
 * Использование: @CurrentUser() user: IUserDataToken
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IUserDataToken => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);
