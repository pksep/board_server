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
import { Op, Transaction } from 'sequelize';
import { ProjectAccessService } from '../projects/project-access.service';

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
    private projectAccess: ProjectAccessService
  ) {}

  /** Получить boardId по columnId */
  private async getBoardIdByColumnId(columnId: number): Promise<number> {
    const col = await this.columnRepository.findByPk(columnId, {
      attributes: ['boardId']
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

  /** Общие include для задачи */
  private taskIncludes() {
    return [
      {
        model: TaskAssignee,
        include: [
          { model: User, attributes: ['id', 'login', 'initial', 'image'] }
        ]
      },
      {
        model: TaskTag,
        include: [
          {
            model: ProjectTag,
            attributes: ['id', 'label', 'color', 'description']
          }
        ]
      },
      {
        model: TaskAttachment,
        attributes: ['id', 'fileName', 'objectName', 'mimeType', 'size']
      },
      {
        model: Task,
        as: 'subtasks',
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
            include: [{ model: User, attributes: ['id', 'login', 'initial'] }]
          },
          {
            model: TaskTag,
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
  async getByColumn(columnId: number, userId: number): Promise<Task[]> {
    try {
      await this.assertColumnAccess(columnId, userId);
      return await this.taskRepository.findAll({
        where: { columnId, parentTaskId: null },
        include: this.taskIncludes(),
        order: [['order', 'ASC']]
      });
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
   * Получить задачу по ID
   */
  async getById(id: number, userId: number): Promise<Task> {
    try {
      await this.assertTaskAccess(id, userId);
      const task = await this.taskRepository.findByPk(id, {
        include: this.taskIncludes()
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

      // Инкрементируем счётчик задач в проекте
      await this.projectRepository.increment('taskCounter', {
        where: { id: projectId },
        transaction
      });

      // Перечитываем проект чтобы получить актуальный taskCounter
      const project = await this.projectRepository.findByPk(projectId, {
        attributes: ['id', 'taskCounter'],
        transaction
      });
      if (!project) {
        throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
      }
      const taskCounter = project.taskCounter;

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

      await transaction.commit();
      const result = await this.getById(task.id, userId);

      // WS: уведомляем о создании
      const boardId = await this.getBoardIdByColumnId(columnId);
      this.wsGateway.emitTaskCreated(boardId, result);

      return result;
    } catch (error) {
      await transaction.rollback();
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

      await this.projectRepository.increment('taskCounter', {
        where: { id: projectId },
        transaction
      });

      const updatedProject = await this.projectRepository.findByPk(projectId, {
        attributes: ['id', 'taskCounter'],
        transaction
      });
      const taskCounter = updatedProject?.taskCounter;
      if (!taskCounter) {
        throw new HttpException(
          'Проект не найден или не удалось получить счётчик',
          HttpStatus.NOT_FOUND
        );
      }

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

      await transaction.commit();
      const result = await this.getById(task.id, userId);

      // WS: уведомляем о создании подзадачи
      const boardId = await this.getBoardIdByColumnId(parent.columnId);
      this.wsGateway.emitTaskCreated(boardId, result);

      return result;
    } catch (error) {
      await transaction.rollback();
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

      if (dto.title !== undefined) task.title = dto.title;
      if (dto.description !== undefined) task.description = dto.description;
      if (dto.priority !== undefined) task.priority = dto.priority;
      if (dto.dueDate !== undefined) task.dueDate = dto.dueDate as any;
      if (dto.approvalStatus !== undefined)
        task.approvalStatus = dto.approvalStatus;

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

      await transaction.commit();
      const result = await this.getById(id, userId);

      // WS: уведомляем об обновлении
      const boardId = await this.getBoardIdByColumnId(result.columnId);
      this.wsGateway.emitTaskUpdated(boardId, result);

      return result;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('update task failed', error);
      throw new HttpException(
        'Ошибка при обновлении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
   * Переместить родительскую задачу вместе со всей иерархией.
   */
  async move(id: number, dto: MoveTaskDto, userId: number): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const task = await this.assertTaskAccess(id, userId, transaction);
      if (task.parentTaskId) {
        throw new HttpException(
          'Перемещайте родительскую задачу вместе с подзадачами',
          HttpStatus.BAD_REQUEST
        );
      }

      const source = await this.getColumnLocation(task.columnId, transaction);
      const target = await this.assertColumnAccess(
        dto.columnId,
        userId,
        transaction
      );
      const hierarchy = await this.getTaskHierarchy(task, transaction);
      const taskIds = hierarchy.map(item => item.id);
      const isCrossProject = source.projectId !== target.projectId;
      const isCrossBoard = source.board.id !== target.board.id;
      const fromColumnId = task.columnId;

      if (fromColumnId !== dto.columnId) {
        await this.normalizeColumnWithoutTask(
          fromColumnId,
          task.id,
          transaction
        );
      }

      const order = await this.placeTaskInColumn(
        task,
        dto.columnId,
        dto.order,
        transaction
      );

      for (const child of hierarchy.slice(1)) {
        child.columnId = dto.columnId;
      }

      if (isCrossProject) {
        const targetProject = await this.projectRepository.findByPk(
          target.projectId,
          { transaction, lock: transaction.LOCK.UPDATE }
        );
        if (!targetProject) {
          throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
        }

        const firstTaskNumber = targetProject.taskCounter + 1;
        targetProject.taskCounter += hierarchy.length;
        await targetProject.save({ transaction });

        hierarchy.forEach((item, index) => {
          item.taskNumber = firstTaskNumber + index;
        });

        await this.taskTagRepository.destroy({
          where: { taskId: taskIds },
          transaction
        });
      }

      await Promise.all(hierarchy.map(item => item.save({ transaction })));

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
          fromColumnId,
          toColumnId: dto.columnId,
          order
        });
      }

      return result;
    } catch (error) {
      await transaction.rollback();
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
    try {
      const task = await this.assertTaskAccess(id, userId);

      const boardId = await this.getBoardIdByColumnId(task.columnId);
      await task.destroy();

      // WS: уведомляем об удалении
      this.wsGateway.emitTaskDeleted(boardId, id);
    } catch (error) {
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
    userId: number
  ): Promise<{ presignedUrl: string; objectName: string }> {
    try {
      await this.assertTaskAccess(taskId, userId);

      const ext = dto.fileName.split('.').pop() || 'bin';
      const objectName = `tasks/${taskId}/${uuidv4()}.${ext}`;

      const presignedUrl = await this.s3Service.getPresignedPutUrl(objectName);

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
