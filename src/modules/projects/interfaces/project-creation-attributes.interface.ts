import type { Optional } from 'sequelize';
import type { Project } from '../model/project.model';
import type { ProjectMember } from '../model/project-member.model';
import type { UserFavorite } from '../model/user-favorite.model';

export type ProjectCreationAttributes = Optional<
  Pick<
    Project,
    | 'id'
    | 'title'
    | 'prefix'
    | 'description'
    | 'showInProduction'
    | 'attributesOwnerOnly'
    | 'taskAttributeDefinitions'
    | 'taskPermissions'
    | 'taskCounter'
    | 'createdById'
  >,
  | 'id'
  | 'description'
  | 'showInProduction'
  | 'attributesOwnerOnly'
  | 'taskAttributeDefinitions'
  | 'taskPermissions'
  | 'taskCounter'
>;

export type ProjectMemberCreationAttributes = Optional<
  Pick<ProjectMember, 'id' | 'projectId' | 'userId' | 'order'>,
  'id' | 'order'
>;

export type UserFavoriteCreationAttributes = Optional<
  Pick<UserFavorite, 'id' | 'projectId' | 'userId'>,
  'id'
>;
