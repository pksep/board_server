import {
  IntersectionType,
  OmitType,
  PartialType,
  PickType
} from '@nestjs/swagger';
import { CreateColumnDto } from './create-column.dto';

export class UpdateColumnDto extends IntersectionType(
  PartialType(OmitType(CreateColumnDto, ['movePermission'] as const)),
  PickType(CreateColumnDto, ['movePermission'] as const)
) {}
