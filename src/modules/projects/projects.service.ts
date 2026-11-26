import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { Project } from './model/project.model';
import { ProjectMember } from './model/project-member.model';
import { UserFavorite } from './model/user-favorite.model';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectTag } from '../tags/model/project-tag.model';
import { ProjectAccessService } from './project-access.service';
import type { ProjectTaskPermissions } from './interfaces/project-task-permissions.interface';
import { restrictTaskPermissionMembers } from './utils/project-task-permissions';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectModel(Project) private projectRepository: typeof Project,
    @InjectModel(ProjectMember) private memberRepository: typeof ProjectMember,
    @InjectModel(UserFavorite) private favoriteRepository: typeof UserFavorite,
    private sequelize: Sequelize,
    private projectAccess: ProjectAccessService
  ) {}

  /**
   * Получить все проекты пользователя
   */
  async getAll(userId: number): Promise<Project[]> {
    try {
      const memberProjectRows = await this.memberRepository.findAll({
        where: { userId },
        attributes: ['projectId', 'order']
      });
      const memberProjectIds = memberProjectRows.map(
        member => member.projectId
      );
      const memberOrderByProjectId = new Map(
        memberProjectRows.map(member => [member.projectId, member.order])
      );

      const projects = await this.projectRepository.findAll({
        include: [
          {
            model: ProjectMember,
            attributes: ['userId']
          },
          {
            model: UserFavorite,
            where: { userId },
            required: false,
            attributes: ['id']
          },
          {
            model: ProjectTag,
            attributes: ['id', 'label', 'color', 'description']
          }
        ],
        where: {
          [Op.or]: [
            { createdById: userId },
            ...(memberProjectIds.length
              ? [{ id: { [Op.in]: memberProjectIds } }]
              : [])
          ]
        },
        order: [['createdAt', 'DESC']]
      });

      return projects.sort((left, right) => {
        const leftOrder = memberOrderByProjectId.get(left.id);
        const rightOrder = memberOrderByProjectId.get(right.id);

        if (leftOrder !== undefined && rightOrder !== undefined) {
          return leftOrder - rightOrder;
        }
        if (leftOrder !== undefined) return -1;
        if (rightOrder !== undefined) return 1;

        return right.createdAt.getTime() - left.createdAt.getTime();
      });
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : 'getAll failed',
        ProjectsService.name
      );
      throw new HttpException(
        'Не удалось получить проекты',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить проект по ID
   */
  async getById(id: number, userId: number): Promise<Project> {
    try {
      await this.projectAccess.assertCanRead(id, userId);
      const project = await this.projectRepository.findByPk(id, {
        include: [
          {
            model: ProjectMember,
            attributes: ['userId']
          },
          {
            model: ProjectTag,
            attributes: ['id', 'label', 'color', 'description']
          }
        ]
      });

      if (!project) {
        throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
      }

      return project;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getById failed', error);
      throw new HttpException(
        'Ошибка при получении проекта',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Создать проект
   */
  async create(dto: CreateProjectDto, userId: number): Promise<Project> {
    const transaction = await this.sequelize.transaction();
    try {
      // Проверка уникальности prefix
      const existing = await this.projectRepository.findOne({
        where: { prefix: dto.prefix.toUpperCase() },
        transaction
      });

      if (existing) {
        throw new HttpException(
          'Проект с таким префиксом уже существует',
          HttpStatus.CONFLICT
        );
      }

      const project = await this.projectRepository.create(
        {
          title: dto.title,
          prefix: dto.prefix.toUpperCase(),
          description: dto.description || '',
          attributesOwnerOnly: dto.attributesOwnerOnly ?? true,
          showInProduction: dto.showInProduction ?? false,
          taskPermissions: dto.taskPermissions ?? null,
          taskAttributeDefinitions: this.normalizeTaskAttributeDefinitions(
            dto.taskAttributeDefinitions
          ),
          createdById: userId
        } as any,
        { transaction }
      );

      // Для каждого участника порядок проектов хранится отдельно.
      const memberIds = Array.from(
        new Set([userId, ...(dto.membersIds || [])])
      );
      await this.assertTaskPermissionReferences(
        project.id,
        dto.taskPermissions,
        memberIds,
        transaction
      );
      const nextOrderByMemberId = await this.getNextMemberOrders(
        memberIds,
        transaction
      );
      const members: Array<{
        projectId: number;
        userId: number;
        order: number;
      }> = memberIds.map(memberId => ({
        projectId: project.id,
        userId: memberId,
        order: nextOrderByMemberId.get(memberId) ?? 0
      }));
      await this.memberRepository.bulkCreate(members as any[], { transaction });

      await transaction.commit();

      return this.getById(project.id, userId);
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : 'Ошибка при создании проекта';
      this.logger.error(error, ProjectsService.name);
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Обновить проект
   */
  async update(dto: UpdateProjectDto, userId: number): Promise<Project> {
    const transaction = await this.sequelize.transaction();
    try {
      const project = await this.projectAccess.assertCanManage(
        dto.id,
        userId,
        transaction
      );

      if (dto.title !== undefined) project.title = dto.title;
      if (dto.description !== undefined) project.description = dto.description;
      if (dto.attributesOwnerOnly !== undefined) {
        project.attributesOwnerOnly = dto.attributesOwnerOnly;
      }
      if (dto.showInProduction !== undefined) {
        project.showInProduction = dto.showInProduction;
      }
      if (dto.taskAttributeDefinitions !== undefined) {
        project.taskAttributeDefinitions =
          this.normalizeTaskAttributeDefinitions(dto.taskAttributeDefinitions);
      }

      if (dto.taskPermissions !== undefined) {
        const memberIds = dto.membersIds
          ? [...new Set([userId, ...dto.membersIds])]
          : [
              userId,
              ...(await this.projectAccess.getActiveMemberIds(
                dto.id,
                transaction
              ))
            ];
        await this.assertTaskPermissionReferences(
          dto.id,
          dto.taskPermissions,
          memberIds,
          transaction
        );
        project.taskPermissions = dto.taskPermissions;
      } else if (dto.membersIds && project.taskPermissions) {
        const remaining = new Set([userId, ...dto.membersIds]);
        project.taskPermissions = restrictTaskPermissionMembers(
          project.taskPermissions,
          remaining
        );
      }

      await project.save({ transaction });

      // Обновляем участников
      if (dto.membersIds) {
        const desiredMemberIds = Array.from(
          new Set([userId, ...dto.membersIds])
        );
        const existingMembers = await this.memberRepository.findAll({
          where: { projectId: dto.id },
          transaction
        });
        const existingMemberIds = new Set(
          existingMembers.map(member => member.userId)
        );

        const retainedMembers = new Set(desiredMemberIds);
        if (
          existingMembers.some(member => !retainedMembers.has(member.userId))
        ) {
          await this.memberRepository.destroy({
            where: {
              projectId: dto.id,
              userId: { [Op.notIn]: desiredMemberIds }
            },
            transaction
          });
        }

        const newMemberIds = desiredMemberIds.filter(
          memberId => !existingMemberIds.has(memberId)
        );
        const nextOrderByMemberId = await this.getNextMemberOrders(
          newMemberIds,
          transaction
        );
        const newMembers: Array<{
          projectId: number;
          userId: number;
          order: number;
        }> = newMemberIds.map(memberId => ({
          projectId: dto.id,
          userId: memberId,
          order: nextOrderByMemberId.get(memberId) ?? 0
        }));
        if (newMembers.length) {
          await this.memberRepository.bulkCreate(newMembers as any[], {
            transaction
          });
        }
      }

      await transaction.commit();

      return this.getById(dto.id, userId);
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('update failed', error);
      throw new HttpException(
        'Ошибка при обновлении проекта',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /** Не позволяет выдать право на колонку другого проекта или постороннему человеку. */
  private async assertTaskPermissionReferences(
    projectId: number,
    permissions: ProjectTaskPermissions | null | undefined,
    memberIds: number[],
    transaction: Transaction
  ): Promise<void> {
    if (!permissions) return;

    const boards = permissions.boards ?? [];
    const boardIds = boards.filter(Boolean).map(board => board.boardId);

    if (
      boardIds.length !== boards.length ||
      new Set(boardIds).size !== boardIds.length
    ) {
      throw new HttpException(
        'Для каждой доски добавьте только один набор разрешений',
        HttpStatus.BAD_REQUEST
      );
    }

    if (boardIds.length) {
      const owned = await this.sequelize.query<{ id: number }>(
        'SELECT id FROM boards WHERE project_id = :projectId AND id IN (:boardIds)',
        {
          replacements: { projectId, boardIds },
          transaction,
          type: QueryTypes.SELECT
        }
      );
      if (owned.length !== boardIds.length) {
        throw new HttpException(
          'Доски должны относиться к этому проекту',
          HttpStatus.BAD_REQUEST
        );
      }
    }

    const members = new Set(memberIds);
    const scopes = [{ ...permissions, boardId: null }, ...boards];
    if (
      scopes.some(scope => scope.createUserIds?.some(id => !members.has(id)))
    ) {
      throw new HttpException(
        'Для создания задач выберите участников проекта',
        HttpStatus.BAD_REQUEST
      );
    }

    const createRules = scopes.flatMap(scope => scope.createRules ?? []);
    if (
      createRules.some(
        rule =>
          !rule ||
          !rule.userIds.length ||
          !rule.columnIds.length ||
          rule.userIds.some(id => !members.has(id))
      )
    ) {
      throw new HttpException(
        'Для создания задач выберите участников проекта и колонки',
        HttpStatus.BAD_REQUEST
      );
    }

    const scopeColumns = scopes.map(scope => ({
      boardId: scope.boardId,
      ids: [
        ...[
          scope.assignee,
          scope.responsible,
          scope.controller,
          scope.otherMember
        ].flatMap(role => [
          ...(role?.moveToColumnIds ?? []),
          ...(role?.moveFromColumnIds ?? [])
        ]),
        ...(scope.createRules ?? []).flatMap(rule => rule.columnIds)
      ]
    }));
    const columnIds = [...new Set(scopeColumns.flatMap(scope => scope.ids))];
    if (!columnIds.length) return;

    // Архивные колонки сохраняют принадлежность проекту; задачи в них всё равно нельзя создать до восстановления.
    const columns = await this.sequelize.query<{ id: number; boardId: number }>(
      `SELECT col.id, col.board_id AS "boardId" FROM board_columns col
       JOIN boards board ON board.id = col.board_id
       WHERE board.project_id = :projectId AND col.id IN (:columnIds)`,
      {
        replacements: { projectId, columnIds },
        transaction,
        type: QueryTypes.SELECT
      }
    );
    if (columns.length !== columnIds.length) {
      throw new HttpException(
        'Колонки должны относиться к этому проекту',
        HttpStatus.BAD_REQUEST
      );
    }

    const columnBoards = new Map(
      columns.map(column => [column.id, column.boardId])
    );
    if (
      scopeColumns.some(
        scope =>
          scope.boardId !== null &&
          scope.ids.some(id => columnBoards.get(id) !== scope.boardId)
      )
    ) {
      throw new HttpException(
        'Колонки должны относиться к выбранной доске',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Soft delete проекта
   */
  async delete(id: number, userId: number): Promise<void> {
    try {
      const project = await this.projectAccess.assertCanManage(id, userId);
      await project.destroy(); // paranoid → soft delete
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('delete failed', error);
      throw new HttpException(
        'Ошибка при удалении проекта',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Сохраняет порядок всех доступных пользователю проектов.
   */
  async reorder(ids: number[], userId: number): Promise<void> {
    const transaction = await this.sequelize.transaction();
    try {
      const memberships = await this.memberRepository.findAll({
        attributes: ['projectId'],
        where: { userId },
        include: [{ model: Project, attributes: [], required: true }],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const accessibleProjectIds = memberships.map(member => member.projectId);
      const requestedIds = [...new Set(ids)];
      const accessibleIdSet = new Set(accessibleProjectIds);

      if (
        requestedIds.length !== ids.length ||
        requestedIds.length !== accessibleProjectIds.length ||
        requestedIds.some(id => !accessibleIdSet.has(id))
      ) {
        throw new HttpException(
          'Порядок должен содержать все доступные проекты без повторов',
          HttpStatus.BAD_REQUEST
        );
      }

      if (requestedIds.length) {
        await this.sequelize.query(
          'UPDATE project_members AS member ' +
            'SET "order" = requested.position::int - 1, "updatedAt" = $updatedAt ' +
            'FROM unnest($ids::int[]) WITH ORDINALITY AS requested(id, position) ' +
            'WHERE member.project_id = requested.id AND member.user_id = $userId',
          {
            bind: { ids: requestedIds, userId, updatedAt: new Date() },
            transaction
          }
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('reorder failed', error);
      throw new HttpException(
        'Не удалось изменить порядок проектов',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Toggle избранное
   */
  async toggleFavorite(
    projectId: number,
    userId: number
  ): Promise<{ isFavorite: boolean }> {
    try {
      await this.projectAccess.assertCanRead(projectId, userId);
      const existing = await this.favoriteRepository.findOne({
        where: { projectId, userId }
      });

      if (existing) {
        await existing.destroy();
        return { isFavorite: false };
      }

      await this.favoriteRepository.create({ projectId, userId } as any);
      return { isFavorite: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('toggleFavorite failed', error);
      throw new HttpException(
        'Ошибка при обновлении избранного',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Проверка уникальности prefix
   */
  async checkPrefix(prefix: string): Promise<{ available: boolean }> {
    const existing = await this.projectRepository.findOne({
      where: { prefix: prefix.toUpperCase() }
    });
    return { available: !existing };
  }

  /** Нормализует определения и запрещает дубли ID или названий внутри проекта. */
  private normalizeTaskAttributeDefinitions(
    definitions: CreateProjectDto['taskAttributeDefinitions'] = []
  ): NonNullable<CreateProjectDto['taskAttributeDefinitions']> {
    const normalized = definitions.map(definition => ({
      id: definition.id,
      name: definition.name.trim(),
      type: definition.type
    }));
    const ids = new Set(normalized.map(definition => definition.id));
    const names = new Set(
      normalized.map(definition => definition.name.toLocaleLowerCase('ru'))
    );

    if (ids.size !== normalized.length || names.size !== normalized.length) {
      throw new HttpException(
        'Названия и идентификаторы атрибутов проекта не должны повторяться',
        HttpStatus.BAD_REQUEST
      );
    }

    return normalized;
  }

  /** Одним запросом рассчитывает следующую позицию проекта для всех участников. */
  private async getNextMemberOrders(
    userIds: number[],
    transaction: Transaction
  ): Promise<Map<number, number>> {
    if (!userIds.length) return new Map();

    const memberships = await this.memberRepository.findAll({
      attributes: ['userId', 'order'],
      where: { userId: { [Op.in]: userIds } },
      transaction
    });
    const nextOrderByMemberId = new Map(userIds.map(memberId => [memberId, 0]));

    for (const membership of memberships) {
      const nextOrder = membership.order + 1;
      if (nextOrder > (nextOrderByMemberId.get(membership.userId) ?? 0)) {
        nextOrderByMemberId.set(membership.userId, nextOrder);
      }
    }

    return nextOrderByMemberId;
  }
}
