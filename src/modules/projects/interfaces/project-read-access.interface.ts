import type { Project } from '../model/project.model';

/** Снимок прав одного пользователя в пределах общей транзакции чтения. */
export interface ProjectReadAccessContext {
  projectsById: Map<number, Project>;
  memberProjectIds: Set<number>;
}
