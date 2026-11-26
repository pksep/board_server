import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  Max,
  Min
} from 'class-validator';

export class TaskCommentTotalsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  taskIds: number[];
}
