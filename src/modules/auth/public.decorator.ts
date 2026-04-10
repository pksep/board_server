import { SetMetadata } from '@nestjs/common';

/** Декоратор для маршрутов, не требующих аутентификации */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
