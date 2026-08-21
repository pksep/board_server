import { BadRequestException } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * Выполняет ту же runtime-валидацию DTO для внутренних вызовов, которую
 * ValidationPipe выполняет для HTTP-контроллеров.
 */
export async function validateDto<T extends object>(
  dtoClass: ClassConstructor<T>,
  input: unknown
): Promise<T> {
  const dto = plainToInstance(dtoClass, input);
  const errors = await validate(dto, {
    forbidUnknownValues: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  if (errors.length > 0) {
    throw new BadRequestException(flattenValidationErrors(errors));
  }

  return dto;
}

/** Собирает вложенные сообщения class-validator в плоский пользовательский список. */
function flattenValidationErrors(errors: ValidationError[]): string[] {
  return errors.flatMap(error => [
    ...Object.values(error.constraints || {}),
    ...flattenValidationErrors(error.children || [])
  ]);
}
