import type {
  ProjectTaskPermissions,
  TaskPermissionRules
} from '../interfaces/project-task-permissions.interface';

export type ProjectTaskRole = 'controller' | 'responsible' | 'assignee';

/** Отдельные настройки доски заменяют общие правила только на этой доске. */
export function getTaskPermissionsForBoard(
  permissions: ProjectTaskPermissions | null | undefined,
  boardId: number | undefined
): TaskPermissionRules | null {
  return (
    permissions?.boards?.find(board => board.boardId === boardId) ??
    permissions ??
    null
  );
}

/** Удаляет выбывших участников из правил проекта и всех отдельных досок. */
export function restrictTaskPermissionMembers(
  permissions: ProjectTaskPermissions,
  members: ReadonlySet<number>
): ProjectTaskPermissions {
  const restrict = <T extends TaskPermissionRules>(scope: T): T => ({
    ...scope,
    ...(scope.createUserIds == null
      ? {}
      : { createUserIds: scope.createUserIds.filter(id => members.has(id)) }),
    ...(scope.createRules == null
      ? {}
      : {
          createRules: scope.createRules
            .map(rule => ({
              ...rule,
              userIds: rule.userIds.filter(id => members.has(id))
            }))
            .filter(rule => rule.userIds.length)
        })
  });

  const project = restrict(permissions);

  return project.boards
    ? { ...project, boards: project.boards.map(restrict) }
    : project;
}

/** Проверяет одно направление по спискам ролей. Без списка доступны все колонки. */
export function canMoveProjectTask(
  permissions: TaskPermissionRules | null | undefined,
  roles: ProjectTaskRole[],
  direction: 'moveToColumnIds' | 'moveFromColumnIds',
  columnId: number
): boolean {
  return roles.some(
    role => permissions?.[role]?.[direction]?.includes(columnId) ?? true
  );
}

/** Разрешение любой роли достаточно для изменения атрибутов. */
export function canEditProjectTaskAttributes(
  permissions: TaskPermissionRules | null | undefined,
  roles: ProjectTaskRole[]
): boolean {
  return roles.some(
    role => permissions?.[role]?.canEditAttributes ?? role === 'controller'
  );
}

/** Новый список действует на всю область; старые правила продолжают работать до замены. */
export function canCreateProjectTask(
  permissions: TaskPermissionRules | null | undefined,
  userId: number,
  columnId: number
): boolean {
  if (permissions?.createUserIds != null) {
    return permissions.createUserIds.includes(userId);
  }

  const rules = permissions?.createRules;

  return (
    rules == null ||
    rules.some(
      rule => rule.userIds.includes(userId) && rule.columnIds.includes(columnId)
    )
  );
}
