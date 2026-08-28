import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Task } from './model/task.model';
import { TaskAssignee } from './model/task-assignee.model';
import { TaskTag } from './model/task-tag.model';
import { TaskAttachment } from './model/task-attachment.model';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { Project } from '../projects/model/project.model';
import { BoardColumn } from '../columns/model/board-column.model';
import { Board } from '../boards/model/board.model';
import { User } from '../users/model/users.model';
import { ProjectTag } from '../tags/model/project-tag.model';
import { WsGateway } from '../ws/ws.gateway';
import { S3Service } from '../s3/s3.service';
import { v4 as uuidv4 } from 'uuid';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { ProjectAccessService } from '../projects/project-access.service';
import { ActivityEventsService } from '../activity-events/activity-events.service';
import {
  ActivityActionType,
  ActivityEntityType
} from '../activity-events/activity-events.constants';
import { ActivityHistoryQueryDto } from '../activity-events/dto/activity-history-query.dto';
import type { Request } from 'express';
import { TaskListQueryDto } from './dto/task-list-query.dto';

interface TaskListPage {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectModel(Task) private taskRepository: typeof Task,
    @InjectModel(TaskAssignee) private assigneeRepository: typeof TaskAssignee,
    @InjectModel(TaskTag) private taskTagRepository: typeof TaskTag,
    @InjectModel(TaskAttachment)
    private attachmentRepository: typeof TaskAttachment,
    @InjectModel(Project) private projectRepository: typeof Project,
    @InjectModel(BoardColumn) private columnRepository: typeof BoardColumn,
    @InjectModel(Board) private boardRepository: typeof Board,
    private sequelize: Sequelize,
    private wsGateway: WsGateway,
    private s3Service: S3Service,
    private projectAccess: ProjectAccessService,
    private activityEvents: ActivityEventsService
  ) {}

  /** Получить boardId по columnId */
  private async getBoardIdByColumnId(
    columnId: number,
    transaction?: Transaction
  ): Promise<number> {
    const col = await this.columnRepository.findByPk(columnId, {
      attributes: ['boardId'],
      ...(transaction ? { transaction } : {})
    });
    return col?.boardId;
  }

  /** Получить projectId через column → board → project */
  private async getProjectIdByColumnId(
    columnId: number,
    transaction?: Transaction
  ): Promise<number> {
    const column = await this.columnRepository.findByPk(columnId, {
      include: [{ model: Board, attributes: ['projectId'] }],
      ...(transaction ? { transaction } : {})
    });
    if (!column) {
      throw new HttpException('Колонка не найдена', HttpStatus.NOT_FOUND);
    }
    return column.board.projectId;
  }

  private async getColumnLocation(
    columnId: number,
    transaction?: Transaction
  ): Promise<{ column: BoardColumn; board: Board; projectId: number }> {
    const column = await this.columnRepository.findByPk(columnId, {
      transaction
    });
    if (!column) {
      throw new HttpException('Колонка не найдена', HttpStatus.NOT_FOUND);
    }

    const board = await this.boardRepository.findByPk(column.boardId, {
      transaction
    });
    if (!board) {
      throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
    }

    return { column, board, projectId: board.projectId };
  }

  private async assertColumnAccess(
    columnId: number,
    userId: number,
    transaction?: Transaction
  ) {
    const location = await this.getColumnLocation(columnId, transaction);
    await this.projectAccess.assertCanRead(
      location.projectId,
      userId,
      transaction
    );
    return location;
  }

  private async assertTaskAccess(
    taskId: number,
    userId: number,
    transaction?: Transaction
  ): Promise<Task> {
    const task = await this.taskRepository.findByPk(taskId, { transaction });
    if (!task) {
      throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
    }
    await this.assertColumnAccess(task.columnId, userId, transaction);
    return task;
  }

  private normalizeIds(ids: number[] = []): number[] {
    return [...new Set(ids.map(Number))].sort((left, right) => left - right);
  }

  private normalizeDate(
    value: Date | string | null | undefined
  ): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  /**
   * Атомарно выделяет последовательный диапазон номеров задач проекта.
   */
  private async allocateTaskNumbers(
    projectId: number,
    count: number,
    transaction: Transaction
  ): Promise<number> {
    // Блокировка проекта сериализует все конкурентные операции нумерации.
    const project = await this.projectRepository.findByPk(projectId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!project) {
      throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
    }

    // Реальный максимум страхует проекты с устаревшим taskCounter.
    const [maximum] = await this.sequelize.query<{
      maxTaskNumber: number | string;
    }>(
      `SELECT COALESCE(MAX(task.task_number), 0)::int AS "maxTaskNumber"
       FROM tasks task
       INNER JOIN board_columns column_item
         ON column_item.id = task.column_id
       INNER JOIN boards board
         ON board.id = column_item.board_id
       WHERE board.project_id = :projectId`,
      {
        replacements: { projectId },
        transaction,
        type: QueryTypes.SELECT
      }
    );

    const currentMaximum = Math.max(
      Number(project.taskCounter) || 0,
      Number(maximum?.maxTaskNumber) || 0
    );
    const firstTaskNumber = currentMaximum + 1;

    project.taskCounter = currentMaximum + count;
    await project.save({ transaction });

    return firstTaskNumber;
  }

  /**
   * Нормализует пустое HTML-описание для сравнения в истории действий.
   */
  private normalizeDescription(value: string | null | undefined): string {
    // Tiptap может представить пустой редактор как пустую строку или пустой p.
    const description = value?.trim() || '';
    if (!description) {
      return '';
    }

    // Убираем только безопасную пустую обёртку, сохраняя значимые HTML-элементы.
    const content = description
      .replace(/&(?:nbsp|#160|#xA0);/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/?(?:p|div)(?:\s[^>]*)?>/gi, '')
      .trim();

    return content ? description : '';
  }

  private async getAssigneeIds(
    taskId: number,
    transaction: Transaction
  ): Promise<number[]> {
    const assignees = await this.assigneeRepository.findAll({
      where: { taskId },
      attributes: ['userId'],
      transaction
    });
    return this.normalizeIds(assignees.map(assignee => assignee.userId));
  }

  private async getTagIds(
    taskId: number,
    transaction: Transaction
  ): Promise<number[]> {
    const tags = await this.taskTagRepository.findAll({
      where: { taskId },
      attributes: ['projectTagId'],
      transaction
    });
    return this.normalizeIds(tags.map(tag => tag.projectTagId));
  }

  private createdTaskChanges(
    task: Task,
    assigneeIds: number[] = [],
    tagIds: number[] = []
  ) {
    return this.activityEvents.buildChanges({
      title: { before: null, after: task.title },
      description: { before: null, after: task.description },
      priority: { before: null, after: task.priority },
      approvalStatus: { before: null, after: task.approvalStatus },
      dueDate: { before: null, after: this.normalizeDate(task.dueDate) },
      columnId: { before: null, after: task.columnId },
      parentTaskId: { before: null, after: task.parentTaskId },
      assigneeIds: { before: [], after: this.normalizeIds(assigneeIds) },
      tagIds: { before: [], after: this.normalizeIds(tagIds) }
    });
  }

  /** Общие include для задачи */
  private taskIncludes() {
    return [
      {
        model: TaskAssignee,
        separate: true,
        include: [
          { model: User, attributes: ['id', 'login', 'initial', 'image'] }
        ]
      },
      {
        model: TaskTag,
        separate: true,
        include: [
          {
            model: ProjectTag,
            attributes: ['id', 'label', 'color', 'description']
          }
        ]
      },
      {
        model: TaskAttachment,
        separate: true,
        attributes: ['id', 'fileName', 'objectName', 'mimeType', 'size']
      },
      {
        model: Task,
        as: 'subtasks',
        separate: true,
        attributes: [
          'id',
          'taskNumber',
          'title',
          'description',
          'priority',
          'approvalStatus',
          'dueDate',
          'parentTaskId',
          'columnId',
          'order'
        ],
        include: [
          {
            model: TaskAssignee,
            separate: true,
            include: [{ model: User, attributes: ['id', 'login', 'initial'] }]
          },
          {
            model: TaskTag,
            separate: true,
            include: [
              { model: ProjectTag, attributes: ['id', 'label', 'color'] }
            ]
          }
        ]
      }
    ];
  }

  /**
   * Получить все задачи доски
   */
  async getByBoard(boardId: number, userId: number): Promise<Task[]> {
    try {
      const board = await this.boardRepository.findByPk(boardId);
      if (!board) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      await this.projectAccess.assertCanRead(board.projectId, userId);
      const columns = await this.columnRepository.findAll({
        where: { boardId },
        attributes: ['id']
      });
      const columnIds = columns.map(c => c.id);

      return await this.taskRepository.findAll({
        where: { columnId: columnIds, parentTaskId: null },
        include: this.taskIncludes(),
        order: [['order', 'ASC']]
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getByBoard failed', error);
      throw new HttpException(
        'Ошибка при получении задач',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить все задачи колонки
   */
  async getByColumn(
    columnId: number,
    userId: number,
    query: TaskListQueryDto = {}
  ): Promise<Task[] | TaskListPage> {
    try {
      await this.assertColumnAccess(columnId, userId);
      const search = query.search?.trim();
      const searchRootTaskIds = search
        ? await this.findMatchingRootTaskIds(columnId, search)
        : null;
      const filteredRootTaskIds = this.hasStructuredTaskFilters(query)
        ? await this.findFilteredRootTaskIds(columnId, query)
        : null;
      const rootTaskIds = this.intersectOptionalIdLists(
        searchRootTaskIds,
        filteredRootTaskIds
      );
      const where = {
        columnId,
        parentTaskId: null,
        ...(rootTaskIds !== null ? { id: { [Op.in]: rootTaskIds } } : {})
      };
      const isPaginated = query.limit !== undefined;
      const limit = query.limit ?? 0;
      const offset = query.offset ?? 0;

      if (!isPaginated) {
        return await this.taskRepository.findAll({
          where,
          include: this.taskIncludes(),
          order: [
            ['order', 'ASC'],
            ['id', 'ASC']
          ]
        });
      }

      const [total, items] = await Promise.all([
        this.taskRepository.count({ where }),
        this.taskRepository.findAll({
          where,
          include: this.taskIncludes(),
          order: [
            ['order', 'ASC'],
            ['id', 'ASC']
          ],
          limit,
          offset
        })
      ]);

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getByColumn failed', error);
      throw new HttpException(
        'Ошибка при получении задач колонки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Находит корневые задачи, у которых совпал номер, текст самой задачи
   * или текст одной из подзадач.
   */
  private async findMatchingRootTaskIds(
    columnId: number,
    search: string
  ): Promise<number[]> {
    const trailingNumber = search.match(/(\d+)$/)?.[1];
    const matches = await this.taskRepository.findAll({
      where: {
        columnId,
        [Op.or]: [
          { title: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } },
          ...(trailingNumber ? [{ taskNumber: Number(trailingNumber) }] : [])
        ]
      },
      attributes: ['id', 'parentTaskId'],
      raw: true
    });

    return [
      ...new Set(matches.map(task => Number(task.parentTaskId || task.id)))
    ];
  }

  /** Проверяет, есть ли в запросе фильтры по атрибутам задачи. */
  private hasStructuredTaskFilters(query: TaskListQueryDto): boolean {
    return Boolean(
      query.assigneeIds?.length ||
      query.priorities?.length ||
      query.tagIds?.length
    );
  }

  /** Пересекает два необязательных списка, не превращая отсутствие фильтра в пустой результат. */
  private intersectOptionalIdLists(
    left: number[] | null,
    right: number[] | null
  ): number[] | null {
    if (left === null) return right;
    if (right === null) return left;

    const rightIds = new Set(right);
    return left.filter(id => rightIds.has(id));
  }

  /** Пересекает идентификаторы задач, совпавших с разными группами фильтров. */
  private intersectTaskIdSets(
    current: Set<number>,
    next: Set<number>
  ): Set<number> {
    return new Set([...current].filter(id => next.has(id)));
  }

  /** Поднимается по цепочке родителей и возвращает ID корневой карточки. */
  private findRootTaskId(taskId: number, tasksById: Map<number, Task>): number {
    const visitedTaskIds = new Set<number>();
    let currentTaskId = taskId;

    while (!visitedTaskIds.has(currentTaskId)) {
      visitedTaskIds.add(currentTaskId);
      const parentTaskId = Number(
        tasksById.get(currentTaskId)?.parentTaskId || 0
      );

      if (!parentTaskId) return currentTaskId;
      currentTaskId = parentTaskId;
    }

    return taskId;
  }

  /**
   * Загружает корневые задачи запрошенной колонки и, при необходимости,
   * всех их потомков независимо от колонки внутри доски.
   */
  private async findFilterCandidates(
    columnId: number,
    query: TaskListQueryDto
  ): Promise<Task[]> {
    const filterPrioritiesInDatabase = Boolean(
      !query.includeSubtasks && query.priorities?.length
    );
    const attributes = [
      'id',
      'parentTaskId',
      ...(query.includeSubtasks ? ['priority'] : [])
    ];
    const roots = await this.taskRepository.findAll({
      where: {
        columnId,
        parentTaskId: null,
        ...(filterPrioritiesInDatabase
          ? { priority: { [Op.in]: query.priorities } }
          : {})
      },
      attributes,
      raw: true
    });

    if (!query.includeSubtasks || !roots.length) return roots;

    const candidates = [...roots];
    const visitedTaskIds = new Set(roots.map(task => Number(task.id)));
    let parentTaskIds = [...visitedTaskIds];

    while (parentTaskIds.length) {
      const children = await this.taskRepository.findAll({
        where: { parentTaskId: { [Op.in]: parentTaskIds } },
        attributes,
        raw: true
      });
      const newChildren = children.filter(
        task => !visitedTaskIds.has(Number(task.id))
      );

      if (!newChildren.length) break;

      candidates.push(...newChildren);
      newChildren.forEach(task => visitedTaskIds.add(Number(task.id)));
      parentTaskIds = newChildren.map(task => Number(task.id));
    }

    return candidates;
  }

  /**
   * Находит корневые карточки, внутри которых задача или разрешённая подзадача
   * одновременно совпала со всеми выбранными группами фильтров.
   */
  private async findFilteredRootTaskIds(
    columnId: number,
    query: TaskListQueryDto
  ): Promise<number[]> {
    const candidates = await this.findFilterCandidates(columnId, query);
    const candidatesById = new Map(
      candidates.map(task => [Number(task.id), task])
    );
    let matchingTaskIds = new Set(
      candidates
        .filter(
          task =>
            !query.includeSubtasks ||
            !query.priorities?.length ||
            query.priorities.includes(task.priority)
        )
        .map(task => Number(task.id))
    );

    if (query.assigneeIds?.length && matchingTaskIds.size) {
      const assignments = await this.assigneeRepository.findAll({
        where: {
          taskId: { [Op.in]: [...matchingTaskIds] },
          userId: { [Op.in]: query.assigneeIds }
        },
        attributes: ['taskId'],
        raw: true
      });
      matchingTaskIds = this.intersectTaskIdSets(
        matchingTaskIds,
        new Set(assignments.map(assignment => Number(assignment.taskId)))
      );
    }

    if (query.tagIds?.length && matchingTaskIds.size) {
      const taskTags = await this.taskTagRepository.findAll({
        where: {
          taskId: { [Op.in]: [...matchingTaskIds] },
          projectTagId: { [Op.in]: query.tagIds }
        },
        attributes: ['taskId'],
        raw: true
      });
      matchingTaskIds = this.intersectTaskIdSets(
        matchingTaskIds,
        new Set(taskTags.map(taskTag => Number(taskTag.taskId)))
      );
    }

    return [
      ...new Set(
        [...matchingTaskIds].map(taskId =>
          this.findRootTaskId(taskId, candidatesById)
        )
      )
    ];
  }

  /**
   * Получить задачу по ID
   */
  async getById(id: number, userId: number): Promise<Task> {
    try {
      await this.assertTaskAccess(id, userId);
      const task = await this.taskRepository.findByPk(id, {
        include: [
          ...this.taskIncludes(),
          {
            model: BoardColumn,
            attributes: ['id', 'boardId']
          }
        ]
      });
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }
      return task;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getById failed', error);
      throw new HttpException(
        'Ошибка при получении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getHistory(id: number, userId: number, query: ActivityHistoryQueryDto) {
    const task = await this.assertTaskAccess(id, userId);
    const projectId = await this.getProjectIdByColumnId(task.columnId);

    return this.activityEvents.findByEntity({
      projectId,
      entityType: ActivityEntityType.Task,
      entityId: String(id),
      limit: query.limit,
      beforeId: query.beforeId
    });
  }

  /**
   * Создать задачу в колонке
   */
  async create(
    columnId: number,
    dto: CreateTaskDto,
    userId: number
  ): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const projectId = await this.getProjectIdByColumnId(
        columnId,
        transaction
      );
      await this.projectAccess.assertCanRead(projectId, userId, transaction);
      if (dto.assigneeIds?.length) {
        await this.projectAccess.assertAssigneesBelongToProject(
          projectId,
          dto.assigneeIds,
          transaction
        );
      }

      const taskCounter = await this.allocateTaskNumbers(
        projectId,
        1,
        transaction
      );

      // Вставляем новую верхнеуровневую задачу в начало колонки.
      await this.taskRepository.update(
        { order: this.sequelize.literal('"order" + 1') as any },
        {
          where: {
            columnId,
            parentTaskId: null
          },
          transaction
        }
      );

      const task = await this.taskRepository.create(
        {
          taskNumber: taskCounter,
          title: dto.title,
          description: dto.description || '',
          priority: dto.priority || '',
          approvalStatus: dto.approvalStatus || '',
          dueDate: dto.dueDate || null,
          columnId,
          order: 0,
          createdById: userId
        } as any,
        { transaction }
      );

      // Добавляем исполнителей
      if (dto.assigneeIds?.length) {
        await this.assigneeRepository.bulkCreate(
          dto.assigneeIds.map(uid => ({
            taskId: task.id,
            userId: uid
          })) as any[],
          { transaction }
        );
      }

      // Добавляем теги
      if (dto.tagIds?.length) {
        await this.taskTagRepository.bulkCreate(
          dto.tagIds.map(tagId => ({
            taskId: task.id,
            projectTagId: tagId
          })) as any[],
          { transaction }
        );
      }

      await this.activityEvents.create(
        {
          projectId,
          entityType: ActivityEntityType.Task,
          entityId: String(task.id),
          actionType: ActivityActionType.Created,
          actorUserId: userId,
          changes: this.createdTaskChanges(task, dto.assigneeIds, dto.tagIds),
          metadata: { taskNumber: task.taskNumber }
        },
        { transaction }
      );

      await transaction.commit();
      const result = await this.getById(task.id, userId);

      // WS: уведомляем о создании
      const boardId = await this.getBoardIdByColumnId(columnId);
      this.wsGateway.emitTaskCreated(boardId, result);

      return result;
    } catch (error) {
      if (!transaction.finished) {
        await transaction.rollback();
      }
      if (error instanceof HttpException) throw error;
      this.logger.error('create task failed', error);
      throw new HttpException(
        'Ошибка при создании задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Создать подзадачу
   */
  async createSubtask(
    parentId: number,
    dto: CreateTaskDto,
    userId: number
  ): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const parent = await this.taskRepository.findByPk(parentId, {
        transaction
      });
      if (!parent) {
        throw new HttpException(
          'Родительская задача не найдена',
          HttpStatus.NOT_FOUND
        );
      }

      const projectId = await this.getProjectIdByColumnId(
        parent.columnId,
        transaction
      );
      await this.projectAccess.assertCanRead(projectId, userId, transaction);
      if (dto.assigneeIds?.length) {
        await this.projectAccess.assertAssigneesBelongToProject(
          projectId,
          dto.assigneeIds,
          transaction
        );
      }

      const taskCounter = await this.allocateTaskNumbers(
        projectId,
        1,
        transaction
      );

      const task = await this.taskRepository.create(
        {
          taskNumber: taskCounter,
          title: dto.title,
          description: dto.description || '',
          priority: dto.priority || '',
          dueDate: dto.dueDate || null,
          columnId: parent.columnId,
          parentTaskId: parentId,
          order: 0,
          createdById: userId
        } as any,
        { transaction }
      );

      if (dto.assigneeIds?.length) {
        await this.assigneeRepository.bulkCreate(
          dto.assigneeIds.map(uid => ({
            taskId: task.id,
            userId: uid
          })) as any[],
          { transaction }
        );
      }

      if (dto.tagIds?.length) {
        await this.taskTagRepository.bulkCreate(
          dto.tagIds.map(tagId => ({
            taskId: task.id,
            projectTagId: tagId
          })) as any[],
          { transaction }
        );
      }

      await this.activityEvents.create(
        {
          projectId,
          entityType: ActivityEntityType.Task,
          entityId: String(task.id),
          actionType: ActivityActionType.Created,
          actorUserId: userId,
          changes: this.createdTaskChanges(task, dto.assigneeIds, dto.tagIds),
          metadata: {
            taskNumber: task.taskNumber,
            parentTaskId: parent.id
          }
        },
        { transaction }
      );

      await this.activityEvents.create(
        {
          projectId,
          entityType: ActivityEntityType.Task,
          entityId: String(parent.id),
          actionType: ActivityActionType.Updated,
          actorUserId: userId,
          changes: [],
          metadata: {
            eventType: 'subtask_created',
            subtaskId: task.id,
            subtaskTitle: task.title,
            taskNumber: task.taskNumber
          }
        },
        { transaction }
      );

      await transaction.commit();
      const result = await this.getById(task.id, userId);

      // WS: уведомляем о создании подзадачи
      const boardId = await this.getBoardIdByColumnId(parent.columnId);
      this.wsGateway.emitTaskCreated(boardId, result);

      return result;
    } catch (error) {
      if (!transaction.finished) {
        await transaction.rollback();
      }
      if (error instanceof HttpException) throw error;
      this.logger.error('createSubtask failed', error);
      throw new HttpException(
        `Ошибка при создании подзадачи: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить подзадачи
   */
  async getSubtasks(parentId: number, userId: number): Promise<Task[]> {
    try {
      await this.assertTaskAccess(parentId, userId);
      return await this.taskRepository.findAll({
        where: { parentTaskId: parentId },
        include: this.taskIncludes(),
        order: [['createdAt', 'ASC']]
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getSubtasks failed', error);
      throw new HttpException(
        'Ошибка при получении подзадач',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Обновить задачу
   */
  async update(id: number, dto: UpdateTaskDto, userId: number): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const task = await this.assertTaskAccess(id, userId, transaction);
      const projectId = await this.getProjectIdByColumnId(
        task.columnId,
        transaction
      );
      if (dto.assigneeIds?.length) {
        await this.projectAccess.assertAssigneesBelongToProject(
          projectId,
          dto.assigneeIds,
          transaction
        );
      }
      const before = {
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: this.normalizeDate(task.dueDate),
        approvalStatus: task.approvalStatus,
        columnId: task.columnId,
        order: task.order,
        parentTaskId: task.parentTaskId,
        assigneeIds:
          dto.assigneeIds === undefined
            ? undefined
            : await this.getAssigneeIds(id, transaction),
        tagIds:
          dto.tagIds === undefined
            ? undefined
            : await this.getTagIds(id, transaction)
      };

      if (
        dto.parentTaskId !== undefined &&
        dto.parentTaskId !== task.parentTaskId
      ) {
        await this.prepareParentTaskChange(task, dto.parentTaskId, transaction);
      }

      if (dto.title !== undefined) task.title = dto.title;
      if (dto.description !== undefined) task.description = dto.description;
      if (dto.priority !== undefined) task.priority = dto.priority;
      if (dto.dueDate !== undefined) task.dueDate = dto.dueDate as any;
      if (dto.approvalStatus !== undefined)
        task.approvalStatus = dto.approvalStatus;
      if (dto.parentTaskId !== undefined) task.parentTaskId = dto.parentTaskId;

      await task.save({ transaction });

      // Обновляем исполнителей
      if (dto.assigneeIds !== undefined) {
        await this.assigneeRepository.destroy({
          where: { taskId: id },
          transaction
        });
        if (dto.assigneeIds.length) {
          await this.assigneeRepository.bulkCreate(
            dto.assigneeIds.map(uid => ({ taskId: id, userId: uid })) as any[],
            { transaction }
          );
        }
      }

      // Обновляем теги
      if (dto.tagIds !== undefined) {
        await this.taskTagRepository.destroy({
          where: { taskId: id },
          transaction
        });
        if (dto.tagIds.length) {
          await this.taskTagRepository.bulkCreate(
            dto.tagIds.map(tagId => ({
              taskId: id,
              projectTagId: tagId
            })) as any[],
            { transaction }
          );
        }
      }

      const changedFields: Record<string, { before: unknown; after: unknown }> =
        {};
      if (dto.title !== undefined) {
        changedFields.title = { before: before.title, after: task.title };
      }
      if (dto.description !== undefined) {
        changedFields.description = {
          before: this.normalizeDescription(before.description),
          after: this.normalizeDescription(task.description)
        };
      }
      if (dto.priority !== undefined) {
        changedFields.priority = {
          before: before.priority,
          after: task.priority
        };
      }
      if (dto.dueDate !== undefined) {
        changedFields.dueDate = {
          before: before.dueDate,
          after: this.normalizeDate(task.dueDate)
        };
      }
      if (dto.approvalStatus !== undefined) {
        changedFields.approvalStatus = {
          before: before.approvalStatus,
          after: task.approvalStatus
        };
      }
      if (dto.parentTaskId !== undefined) {
        changedFields.parentTaskId = {
          before: before.parentTaskId,
          after: task.parentTaskId
        };
        changedFields.columnId = {
          before: before.columnId,
          after: task.columnId
        };
        changedFields.order = {
          before: before.order,
          after: task.order
        };
      }
      if (dto.assigneeIds !== undefined) {
        changedFields.assigneeIds = {
          before: before.assigneeIds,
          after: this.normalizeIds(dto.assigneeIds)
        };
      }
      if (dto.tagIds !== undefined) {
        changedFields.tagIds = {
          before: before.tagIds,
          after: this.normalizeIds(dto.tagIds)
        };
      }

      const changes = this.activityEvents.buildChanges(changedFields);
      if (changes.length) {
        await this.activityEvents.create(
          {
            projectId,
            entityType: ActivityEntityType.Task,
            entityId: String(task.id),
            actionType: ActivityActionType.Updated,
            actorUserId: userId,
            changes,
            metadata: { taskNumber: task.taskNumber }
          },
          { transaction }
        );
      }

      await transaction.commit();
      const result = await this.getById(id, userId);

      // WS: уведомляем об обновлении
      const boardId = await this.getBoardIdByColumnId(result.columnId);
      this.wsGateway.emitTaskUpdated(boardId, result);

      return result;
    } catch (error) {
      if (!transaction.finished) {
        await transaction.rollback();
      }
      if (error instanceof HttpException) throw error;
      this.logger.error('update task failed', error);
      throw new HttpException(
        'Ошибка при обновлении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Проверяет смену родителя и подготавливает порядок корневых карточек.
   * Переносить разрешено только листовую задачу внутри текущей доски.
   */
  private async prepareParentTaskChange(
    task: Task,
    parentTaskId: number | null,
    transaction: Transaction
  ): Promise<void> {
    const childTask = await this.taskRepository.findOne({
      where: { parentTaskId: task.id },
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (childTask) {
      throw new HttpException(
        'Нельзя изменить родителя задачи, у которой есть подзадачи',
        HttpStatus.BAD_REQUEST
      );
    }

    if (parentTaskId === null) {
      if (!task.parentTaskId) return;

      // Откреплённая подзадача становится верхнеуровневой рядом с родителем.
      const currentParent = await this.taskRepository.findByPk(
        task.parentTaskId,
        {
          transaction,
          lock: transaction.LOCK.UPDATE
        }
      );
      if (!currentParent) {
        throw new HttpException(
          'Родительская задача не найдена',
          HttpStatus.NOT_FOUND
        );
      }

      await this.placeTaskInColumn(
        task,
        currentParent.columnId,
        currentParent.order + 1,
        transaction
      );
      return;
    }

    if (parentTaskId === task.id) {
      throw new HttpException(
        'Задача не может быть родительской для самой себя',
        HttpStatus.BAD_REQUEST
      );
    }

    const nextParent = await this.taskRepository.findByPk(parentTaskId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!nextParent) {
      throw new HttpException(
        'Родительская задача не найдена',
        HttpStatus.NOT_FOUND
      );
    }
    if (nextParent.parentTaskId) {
      throw new HttpException(
        'Родительской может быть только верхнеуровневая задача',
        HttpStatus.BAD_REQUEST
      );
    }

    const [taskBoardId, parentBoardId] = await Promise.all([
      this.getBoardIdByColumnId(task.columnId, transaction),
      this.getBoardIdByColumnId(nextParent.columnId, transaction)
    ]);
    if (!taskBoardId || !parentBoardId || taskBoardId !== parentBoardId) {
      throw new HttpException(
        'Родительская задача должна находиться на той же доске',
        HttpStatus.BAD_REQUEST
      );
    }

    if (!task.parentTaskId) {
      // Карточка исчезает из корневого списка, поэтому закрываем разрыв в order.
      await this.normalizeColumnWithoutTask(
        task.columnId,
        task.id,
        transaction
      );
    }
    task.order = 0;
  }

  private async getTaskHierarchy(
    root: Task,
    transaction: Transaction
  ): Promise<Task[]> {
    const hierarchy: Task[] = [root];
    let parentIds = [root.id];

    while (parentIds.length) {
      const children = await this.taskRepository.findAll({
        where: { parentTaskId: parentIds },
        order: [
          ['parentTaskId', 'ASC'],
          ['order', 'ASC'],
          ['id', 'ASC']
        ],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!children.length) break;
      hierarchy.push(...children);
      parentIds = children.map(child => child.id);
    }

    return hierarchy;
  }

  private async normalizeColumnWithoutTask(
    columnId: number,
    taskId: number,
    transaction: Transaction
  ): Promise<void> {
    const tasks = await this.taskRepository.findAll({
      where: {
        columnId,
        parentTaskId: null,
        id: { [Op.ne]: taskId }
      },
      order: [
        ['order', 'ASC'],
        ['id', 'ASC']
      ],
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    await Promise.all(
      tasks.map((task, index) =>
        task.order === index
          ? Promise.resolve(task)
          : task.update({ order: index } as any, { transaction })
      )
    );
  }

  private async placeTaskInColumn(
    task: Task,
    columnId: number,
    requestedOrder: number,
    transaction: Transaction
  ): Promise<number> {
    const tasks = await this.taskRepository.findAll({
      where: {
        columnId,
        parentTaskId: null,
        id: { [Op.ne]: task.id }
      },
      order: [
        ['order', 'ASC'],
        ['id', 'ASC']
      ],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const order = Math.max(0, Math.min(requestedOrder, tasks.length));

    await Promise.all(
      tasks.map((item, index) => {
        const nextOrder = index < order ? index : index + 1;
        return item.order === nextOrder
          ? Promise.resolve(item)
          : item.update({ order: nextOrder } as any, { transaction });
      })
    );

    task.columnId = columnId;
    task.order = order;
    await task.save({ transaction });
    return order;
  }

  /**
   * Перемещает задачу в колонку.
   * Внутри текущей доски задача и её подзадачи меняют колонки независимо.
   * При переносе родительской задачи на другую доску вместе с ней переносится
   * вся иерархия, а отдельно подзадачу на другую доску переносить нельзя.
   */
  async move(id: number, dto: MoveTaskDto, userId: number): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const task = await this.assertTaskAccess(id, userId, transaction);
      const isSubtask = Boolean(task.parentTaskId);
      const source = await this.getColumnLocation(task.columnId, transaction);
      const target = await this.assertColumnAccess(
        dto.columnId,
        userId,
        transaction
      );
      const isCrossProject = source.projectId !== target.projectId;
      const isCrossBoard = source.board.id !== target.board.id;

      if (isSubtask && isCrossBoard) {
        throw new HttpException(
          'Подзадачу можно перемещать только между колонками текущей доски',
          HttpStatus.BAD_REQUEST
        );
      }

      const hierarchy =
        !isSubtask && isCrossBoard
          ? await this.getTaskHierarchy(task, transaction)
          : [task];
      const taskIds = hierarchy.map(item => item.id);
      const beforeMove = new Map(
        hierarchy.map(item => [
          item.id,
          {
            columnId: item.columnId,
            order: item.order,
            taskNumber: item.taskNumber
          }
        ])
      );
      const fromColumnId = task.columnId;

      if (isCrossProject) {
        const assignees = await this.assigneeRepository.findAll({
          attributes: ['userId'],
          where: { taskId: { [Op.in]: taskIds } },
          transaction
        });
        const assigneeIds = assignees.map(assignee => assignee.userId);
        if (assigneeIds.length) {
          await this.projectAccess.assertAssigneesBelongToProject(
            target.projectId,
            assigneeIds,
            transaction
          );
        }
      }

      if (!isSubtask && fromColumnId !== dto.columnId) {
        await this.normalizeColumnWithoutTask(
          fromColumnId,
          task.id,
          transaction
        );
      }

      let order = task.order;
      if (isSubtask) {
        task.columnId = dto.columnId;
      } else {
        order = await this.placeTaskInColumn(
          task,
          dto.columnId,
          dto.order,
          transaction
        );
      }

      for (const child of hierarchy.slice(1)) {
        child.columnId = dto.columnId;
      }

      if (isCrossProject) {
        const firstTaskNumber = await this.allocateTaskNumbers(
          target.projectId,
          hierarchy.length,
          transaction
        );

        hierarchy.forEach((item, index) => {
          item.taskNumber = firstTaskNumber + index;
        });

        await this.taskTagRepository.destroy({
          where: { taskId: taskIds },
          transaction
        });
      }

      await Promise.all(hierarchy.map(item => item.save({ transaction })));

      for (const item of hierarchy) {
        const previous = beforeMove.get(item.id);
        const changes = this.activityEvents.buildChanges({
          projectId: {
            before: source.projectId,
            after: target.projectId
          },
          boardId: {
            before: source.board.id,
            after: target.board.id
          },
          columnId: {
            before: previous.columnId,
            after: item.columnId
          },
          order: {
            before: previous.order,
            after: item.order
          },
          taskNumber: {
            before: previous.taskNumber,
            after: item.taskNumber
          }
        });

        if (!changes.length) continue;

        const event = {
          entityType: ActivityEntityType.Task,
          entityId: String(item.id),
          actionType: ActivityActionType.Moved,
          actorUserId: userId,
          changes,
          metadata: {
            rootTaskId: task.parentTaskId || task.id,
            hierarchySize: hierarchy.length
          }
        };

        if (isCrossProject) {
          await this.activityEvents.create(
            {
              ...event,
              projectId: source.projectId,
              metadata: { ...event.metadata, direction: 'out' }
            },
            { transaction }
          );
        }

        await this.activityEvents.create(
          {
            ...event,
            projectId: target.projectId,
            metadata: {
              ...event.metadata,
              direction: isCrossProject ? 'in' : 'within'
            }
          },
          { transaction }
        );
      }

      await transaction.commit();
      const result = await this.getById(id, userId);

      if (isCrossBoard) {
        this.wsGateway.emitTaskRelocated(source.board.id, target.board.id, {
          task: result,
          taskIds,
          fromProjectId: source.projectId,
          toProjectId: target.projectId,
          fromBoardId: source.board.id,
          toBoardId: target.board.id,
          fromColumnId,
          toColumnId: dto.columnId,
          order
        });
      } else {
        this.wsGateway.emitTaskMoved(target.board.id, {
          taskId: id,
          taskIds,
          fromColumnId,
          toColumnId: dto.columnId,
          order
        });
      }

      return result;
    } catch (error) {
      if (!transaction.finished) {
        await transaction.rollback();
      }
      if (error instanceof HttpException) throw error;
      this.logger.error('move task failed', error);
      throw new HttpException(
        'Ошибка при перемещении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Soft delete задачи
   */
  async delete(id: number, userId: number): Promise<void> {
    const transaction = await this.sequelize.transaction();
    try {
      const task = await this.assertTaskAccess(id, userId, transaction);
      const projectId = await this.getProjectIdByColumnId(
        task.columnId,
        transaction
      );

      const boardId = await this.getBoardIdByColumnId(task.columnId);
      await task.destroy({ transaction });
      await this.activityEvents.create(
        {
          projectId,
          entityType: ActivityEntityType.Task,
          entityId: String(task.id),
          actionType: ActivityActionType.Deleted,
          actorUserId: userId,
          changes: this.activityEvents.buildChanges({
            title: { before: task.title, after: null },
            columnId: { before: task.columnId, after: null },
            parentTaskId: { before: task.parentTaskId, after: null }
          }),
          metadata: { taskNumber: task.taskNumber }
        },
        { transaction }
      );
      await transaction.commit();

      // WS: уведомляем об удалении
      this.wsGateway.emitTaskDeleted(boardId, id);
    } catch (error) {
      if (!transaction.finished) {
        await transaction.rollback();
      }
      if (error instanceof HttpException) throw error;
      this.logger.error('delete task failed', error);
      throw new HttpException(
        'Ошибка при удалении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить Presigned URL для прямой загрузки в MinIO
   */
  async generatePresignedUrl(
    taskId: number,
    dto: CreateAttachmentDto,
    userId: number,
    req?: Request
  ): Promise<{ presignedUrl: string; objectName: string }> {
    try {
      await this.assertTaskAccess(taskId, userId);

      const ext = dto.fileName.split('.').pop() || 'bin';
      const objectName = `tasks/${taskId}/${uuidv4()}.${ext}`;

      const presignedUrl = await this.s3Service.getPresignedPutUrl(
        objectName,
        req
      );

      return { presignedUrl, objectName };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('generatePresignedUrl failed', error);
      throw new HttpException(
        'Ошибка при генерации URL для загрузки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Подтвердить успешную загрузку и привязать к задаче
   */
  async confirmAttachment(
    taskId: number,
    dto: CreateAttachmentDto,
    userId: number
  ): Promise<TaskAttachment> {
    try {
      const task = await this.assertTaskAccess(taskId, userId);
      if (!dto.objectName) {
        throw new HttpException(
          'Не передан objectName',
          HttpStatus.BAD_REQUEST
        );
      }

      // Проверяем, что файл реально загружен в MinIO
      const exists = await this.s3Service.exists(dto.objectName);
      if (!exists) {
        throw new HttpException(
          'Файл не найден в хранилище. Загрузите файл перед подтверждением.',
          HttpStatus.BAD_REQUEST
        );
      }

      const attachment = await this.attachmentRepository.create({
        taskId,
        fileName: dto.fileName,
        objectName: dto.objectName,
        mimeType: dto.mimeType,
        size: dto.size,
        uploadedById: userId
      } as any);

      const boardId = await this.getBoardIdByColumnId(task.columnId);
      const updatedTask = await this.getById(taskId, userId);
      this.wsGateway.emitTaskUpdated(boardId, updatedTask);

      return attachment;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('confirmAttachment failed', error);
      throw new HttpException(
        'Ошибка при подтверждении вложения',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Удалить вложение
   */
  async deleteAttachment(
    taskId: number,
    attachmentId: number,
    userId: number
  ): Promise<void> {
    try {
      await this.assertTaskAccess(taskId, userId);
      const attachment = await this.attachmentRepository.findOne({
        where: { id: attachmentId, taskId }
      });
      if (!attachment) {
        throw new HttpException('Вложение не найдено', HttpStatus.NOT_FOUND);
      }

      await this.s3Service.removeObject(attachment.objectName);
      await attachment.destroy();

      const task = await this.taskRepository.findByPk(taskId);
      if (task) {
        const boardId = await this.getBoardIdByColumnId(task.columnId);
        const updatedTask = await this.getById(taskId, userId);
        this.wsGateway.emitTaskUpdated(boardId, updatedTask);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('deleteAttachment failed', error);
      throw new HttpException(
        'Ошибка при удалении вложения',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
