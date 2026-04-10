import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationException } from 'src/exceptions/validation.exception';

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    const entity = plainToClass(metadata.metatype, value);
    const errors = await validate(entity);

    if (errors.length) {
      const mes = errors.map(
        err => `${err.property} - ${Object.values(err.constraints).join(', ')}`
      );
      throw new ValidationException(mes);
    }

    return value;
  }
}
