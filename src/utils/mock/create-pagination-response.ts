import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

export const createPaginationResponseDto = <TModel>(
  Model: new () => TModel
) => {
  @ApiExtraModels(Model)
  class PaginationResponseDto {
    @ApiProperty({ example: 1 })
    count: number;

    @ApiProperty({
      type: 'array',
      items: { $ref: getSchemaPath(Model) },
      example: []
    })
    rows: TModel[];
  }

  return PaginationResponseDto;
};
