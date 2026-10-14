import {
  IntersectionType,
  OmitType,
  PartialType,
  PickType
} from '@nestjs/swagger';
import { CreateBoardDto } from './create-board.dto';

// Состав допускает пропуск и [], но не null; остальные поля сохраняют прежние правила PartialType.
export class UpdateBoardDto extends IntersectionType(
  PartialType(
    OmitType(CreateBoardDto, ['sourceBoardId', 'membersIds'] as const)
  ),
  PickType(CreateBoardDto, ['membersIds'] as const)
) {}
