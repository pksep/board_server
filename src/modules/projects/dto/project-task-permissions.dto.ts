import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
  ValidateNested
} from 'class-validator';
import type {
  BoardTaskPermissionRules,
  ProjectTaskCreationRule,
  ProjectTaskPermissions,
  ProjectTaskRoleRule,
  TaskPermissionRules
} from '../interfaces/project-task-permissions.interface';

class ProjectTaskRoleRuleDto implements ProjectTaskRoleRule {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  moveToColumnIds?: number[] | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  moveFromColumnIds?: number[] | null;

  @IsOptional()
  @IsBoolean()
  canEditAttributes?: boolean | null;
}

class ProjectTaskCreationRuleDto implements ProjectTaskCreationRule {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  userIds: number[];

  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  columnIds: number[];
}

class TaskPermissionRulesDto implements TaskPermissionRules {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProjectTaskRoleRuleDto)
  assignee?: ProjectTaskRoleRuleDto | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProjectTaskRoleRuleDto)
  responsible?: ProjectTaskRoleRuleDto | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProjectTaskRoleRuleDto)
  controller?: ProjectTaskRoleRuleDto | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  createUserIds?: number[] | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectTaskCreationRuleDto)
  createRules?: ProjectTaskCreationRuleDto[] | null;
}

class BoardTaskPermissionRulesDto
  extends TaskPermissionRulesDto
  implements BoardTaskPermissionRules
{
  @IsInt()
  @Min(1)
  @Max(2147483647)
  boardId: number;
}

export class ProjectTaskPermissionsDto
  extends TaskPermissionRulesDto
  implements ProjectTaskPermissions
{
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoardTaskPermissionRulesDto)
  boards?: BoardTaskPermissionRulesDto[] | null;
}
