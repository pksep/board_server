import { Logger, Module, Injectable } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, Transaction } from 'sequelize';
import { getSequelizeConfig } from 'src/configs/postgres.config';
import { LoggerModule } from 'src/modules/logger/logger.module';
import { Project } from 'src/modules/projects/model/project.model';
import { Board } from 'src/modules/boards/model/board.model';
import { BoardColumn } from 'src/modules/columns/model/board-column.model';
import { Task } from 'src/modules/tasks/model/task.model';

type ImportArgs = {
  projectId: number;
  boardId: number;
  hulyBoardId?: string;
  hulyBoardUrl?: string;
  userId?: number;
  dryRun: boolean;
};

type HulyColumn = {
  id: string;
  title: string;
  order: number;
};

type HulyTask = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  statusId: string;
  parentId: string | null;
};

type HulyBoardSnapshot = {
  id: string;
  identifier: string;
  title: string;
  columns: HulyColumn[];
  tasks: HulyTask[];
};

type ImportSummary = {
  columnsCreated: number;
  columnsReused: number;
  topLevelCreated: number;
  subtasksCreated: number;
  skippedSubtasks: number;
  errors: string[];
};

@Injectable()
class HulyBoardImportRunner {
  private readonly logger = new Logger(HulyBoardImportRunner.name);

  constructor(
    @InjectModel(Project) private projectRepository: typeof Project,
    @InjectModel(Board) private boardRepository: typeof Board,
    @InjectModel(BoardColumn) private columnRepository: typeof BoardColumn,
    @InjectModel(Task) private taskRepository: typeof Task,
    private sequelize: Sequelize
  ) {}

  async run(args: ImportArgs): Promise<ImportSummary> {
    const project = await this.projectRepository.findByPk(args.projectId);
    if (!project) {
      throw new Error(`Проект ${args.projectId} не найден`);
    }

    const board = await this.boardRepository.findByPk(args.boardId);
    if (!board) {
      throw new Error(`Доска ${args.boardId} не найдена`);
    }

    if (board.projectId !== project.id) {
      throw new Error(`Доска ${board.id} не принадлежит проекту ${project.id}`);
    }

    const sourceRef = this.resolveSourceRef(args);

    const createdById = args.userId ?? project.createdById;
    this.logger.log(
      `Импорт Huly "${sourceRef}" -> project=${project.id}, board=${board.id}, createdBy=${createdById}${args.dryRun ? ' (dry-run)' : ''}`
    );

    const snapshot = await this.loadHulyBoardSnapshot(args);

    const summary: ImportSummary = {
      columnsCreated: 0,
      columnsReused: 0,
      topLevelCreated: 0,
      subtasksCreated: 0,
      skippedSubtasks: 0,
      errors: []
    };

    const targetColumns = await this.ensureTargetColumns(
      board.id,
      snapshot.columns,
      summary,
      args.dryRun
    );
    const targetColumnIdBySourceStatusId = new Map<string, number>();
    snapshot.columns.forEach((column, index) => {
      targetColumnIdBySourceStatusId.set(column.id, targetColumns[index].id);
    });

    const createdTaskIdsBySourceId = new Map<string, number>();
    let dryRunTaskId = -1;

    for (const column of snapshot.columns) {
      const targetColumnId = targetColumnIdBySourceStatusId.get(column.id);
      const topLevelTasks = snapshot.tasks.filter(
        task => task.statusId === column.id && !task.parentId
      );

      if (args.dryRun) {
        [...topLevelTasks].reverse().forEach(sourceTask => {
          // Временный ID позволяет проверить и многоуровневые связи без записи.
          createdTaskIdsBySourceId.set(sourceTask.id, dryRunTaskId--);
          summary.topLevelCreated++;
        });
        continue;
      }

      if (!targetColumnId) {
        summary.errors.push(
          `Не найдена целевая колонка для статуса ${column.title} (${column.id})`
        );
        continue;
      }

      for (const sourceTask of [...topLevelTasks].reverse()) {
        try {
          const task = await this.createTopLevelTask(
            project.id,
            targetColumnId,
            createdById,
            sourceTask
          );
          createdTaskIdsBySourceId.set(sourceTask.id, task.id);
          summary.topLevelCreated++;
        } catch (error) {
          summary.errors.push(
            `Не удалось импортировать задачу ${sourceTask.identifier}: ${this.stringifyError(error)}`
          );
        }
      }
    }

    const pendingSubtasks = snapshot.tasks.filter(task => !!task.parentId);
    let madeProgress = true;

    while (pendingSubtasks.length && madeProgress) {
      madeProgress = false;

      for (let index = pendingSubtasks.length - 1; index >= 0; index--) {
        const sourceTask = pendingSubtasks[index];
        const parentId = createdTaskIdsBySourceId.get(
          sourceTask.parentId as string
        );
        if (!parentId) {
          continue;
        }

        try {
          if (args.dryRun) {
            createdTaskIdsBySourceId.set(sourceTask.id, dryRunTaskId--);
          } else {
            const task = await this.createSubtask(
              project.id,
              parentId,
              createdById,
              sourceTask
            );
            createdTaskIdsBySourceId.set(sourceTask.id, task.id);
          }
          summary.subtasksCreated++;
          pendingSubtasks.splice(index, 1);
          madeProgress = true;
        } catch (error) {
          summary.errors.push(
            `Не удалось импортировать подзадачу ${sourceTask.identifier}: ${this.stringifyError(error)}`
          );
          pendingSubtasks.splice(index, 1);
          madeProgress = true;
        }
      }
    }

    pendingSubtasks.forEach(sourceTask => {
      summary.skippedSubtasks++;
      summary.errors.push(
        `Подзадача ${sourceTask.identifier} пропущена: родитель ${sourceTask.parentId} не импортирован`
      );
    });

    this.logger.log(
      `Импорт завершён: columns(created=${summary.columnsCreated}, reused=${summary.columnsReused}), tasks=${summary.topLevelCreated}, subtasks=${summary.subtasksCreated}, skippedSubtasks=${summary.skippedSubtasks}, errors=${summary.errors.length}`
    );

    return summary;
  }

  private resolveSourceRef(args: ImportArgs): string {
    if (args.hulyBoardId) {
      return args.hulyBoardId;
    }

    if (!args.hulyBoardUrl) {
      throw new Error('Нужно указать --hulyBoardId или --hulyBoardUrl');
    }

    return this.extractBoardRefFromUrl(args.hulyBoardUrl);
  }

  private extractBoardRefFromUrl(urlString: string): string {
    try {
      const url = new URL(urlString);
      const queryCandidate =
        url.searchParams.get('board') ||
        url.searchParams.get('project') ||
        url.searchParams.get('identifier');

      if (queryCandidate) {
        return queryCandidate;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      const trackerIndex = pathParts.findIndex(part => part === 'tracker');
      if (trackerIndex >= 0 && pathParts[trackerIndex + 1]) {
        return pathParts[trackerIndex + 1];
      }

      const lastPart = pathParts[pathParts.length - 1];
      if (!lastPart) {
        throw new Error('Не удалось извлечь идентификатор доски из URL');
      }

      return lastPart;
    } catch (error) {
      throw new Error(
        `Не удалось разобрать --hulyBoardUrl: ${this.stringifyError(error)}`
      );
    }
  }

  private async loadHulyBoardSnapshot(
    args: ImportArgs
  ): Promise<HulyBoardSnapshot> {
    let connect: any;
    let NodeWebSocketFactory: any;
    let SortingOrder: any;
    let task: any;
    let tracker: any;

    try {
      const apiClient = require('@hcengineering/api-client');
      const core = require('@hcengineering/core');
      const taskModule = require('@hcengineering/task');
      const trackerModule = require('@hcengineering/tracker');

      connect = apiClient.connect;
      NodeWebSocketFactory = apiClient.NodeWebSocketFactory;
      SortingOrder = core.SortingOrder;
      task = taskModule.default ?? taskModule;
      tracker = trackerModule.default ?? trackerModule;
    } catch (error) {
      throw new Error(
        'Для импорта нужен Huly API client. Установите пакеты @hcengineering/api-client, @hcengineering/core, @hcengineering/task и @hcengineering/tracker'
      );
    }

    const baseUrl = process.env.HULY_BASE_URL || process.env.HULY_URL;
    const workspace = process.env.HULY_WORKSPACE;
    const token = process.env.HULY_TOKEN;
    const email = process.env.HULY_EMAIL;
    const password = process.env.HULY_PASSWORD;

    if (!baseUrl) {
      throw new Error('Не задан HULY_BASE_URL или HULY_URL');
    }
    if (!workspace) {
      throw new Error('Не задан HULY_WORKSPACE');
    }
    if (!token && (!email || !password)) {
      throw new Error(
        'Нужно указать HULY_TOKEN либо пару HULY_EMAIL/HULY_PASSWORD'
      );
    }

    const sourceRef = this.resolveSourceRef(args);
    const client = await connect(baseUrl, {
      workspace,
      ...(token ? { token } : { email, password }),
      socketFactory: NodeWebSocketFactory,
      connectionTimeout: 30000
    });

    try {
      const project =
        (await client.findOne(
          tracker.class.Project,
          { identifier: sourceRef },
          { lookup: { type: task.class.ProjectType } }
        )) ||
        (await client.findOne(
          tracker.class.Project,
          { _id: sourceRef },
          { lookup: { type: task.class.ProjectType } }
        ));

      if (!project) {
        throw new Error(`Доска/проект Huly "${sourceRef}" не найдены`);
      }

      const issues = await client.findAll(
        tracker.class.Issue,
        { space: project._id },
        {
          limit: 5000,
          sort: { rank: SortingOrder.Ascending }
        }
      );

      const columns = this.normalizeHulyColumns(project, issues);
      const tasks: HulyTask[] = [];

      for (const issue of issues) {
        const description = await this.resolveIssueDescription(client, issue);
        tasks.push({
          id: String(issue._id),
          identifier:
            issue.identifier ||
            `${project.identifier || sourceRef}-${issue.number || 'X'}`,
          title: issue.title || '(без названия)',
          description,
          statusId:
            this.extractRef(issue.status) || columns[0]?.id || 'unknown',
          parentId: this.extractParentId(issue)
        });
      }

      return {
        id: String(project._id),
        identifier: project.identifier || sourceRef,
        title: project.title || project.identifier || sourceRef,
        columns,
        tasks
      };
    } finally {
      await client.close();
    }
  }

  private normalizeHulyColumns(project: any, issues: any[]): HulyColumn[] {
    const columns: HulyColumn[] = [];
    const knownStatusIds = new Set<string>();
    const projectStatuses = project?.$lookup?.type?.statuses;

    if (Array.isArray(projectStatuses)) {
      projectStatuses.forEach((status: any, index: number) => {
        const id = this.extractRef(status) || `status-${index + 1}`;
        columns.push({
          id,
          title:
            status?.name ||
            status?.label ||
            status?.title ||
            status?.identifier ||
            `Статус ${index + 1}`,
          order: index
        });
        knownStatusIds.add(id);
      });
    }

    for (const issue of issues) {
      const statusId = this.extractRef(issue.status);
      if (!statusId || knownStatusIds.has(statusId)) {
        continue;
      }

      columns.push({
        id: statusId,
        title:
          issue?.status?.name ||
          issue?.status?.label ||
          issue?.status?.title ||
          issue?.status?.identifier ||
          `Статус ${columns.length + 1}`,
        order: columns.length
      });
      knownStatusIds.add(statusId);
    }

    if (!columns.length) {
      columns.push({ id: 'unknown', title: 'Без статуса', order: 0 });
    }

    return columns;
  }

  private async resolveIssueDescription(
    client: any,
    issue: any
  ): Promise<string> {
    if (!issue?.description) {
      return '';
    }

    try {
      const markdown = await client.fetchMarkup(
        issue._class,
        issue._id,
        'description',
        issue.description,
        'markdown'
      );

      return this.simpleMarkdownToHtml(String(markdown || ''));
    } catch (error) {
      this.logger.warn(
        `Не удалось получить markup для ${issue.identifier || issue._id}, импортирую пустое описание`
      );
      return '';
    }
  }

  private simpleMarkdownToHtml(markdown: string): string {
    const escaped = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return escaped
      .split(/\n{2,}/)
      .map(chunk => `<p>${chunk.replace(/\n/g, '<br/>')}</p>`)
      .join('');
  }

  private extractRef(value: any): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    return value._id ? String(value._id) : null;
  }

  private extractParentId(issue: any): string | null {
    if (Array.isArray(issue?.parents) && issue.parents.length > 0) {
      return this.extractRef(issue.parents[0]);
    }

    if (issue?.parent) {
      return this.extractRef(issue.parent);
    }

    return null;
  }

  private async ensureTargetColumns(
    boardId: number,
    sourceColumns: HulyColumn[],
    summary: ImportSummary,
    dryRun: boolean
  ): Promise<BoardColumn[]> {
    const existingColumns = await this.columnRepository.findAll({
      where: { boardId },
      order: [
        ['order', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });

    const mappedColumns: BoardColumn[] = [];
    const extraColumns = existingColumns.slice(sourceColumns.length);

    for (let index = 0; index < sourceColumns.length; index++) {
      const sourceColumn = sourceColumns[index];
      const existingColumn = existingColumns[index];

      if (existingColumn) {
        mappedColumns.push(existingColumn);
        summary.columnsReused++;
        continue;
      }

      if (dryRun) {
        mappedColumns.push(
          this.columnRepository.build({
            boardId,
            title: sourceColumn.title,
            color: null,
            order: index
          } as any)
        );
        summary.columnsCreated++;
        continue;
      }

      const createdColumn = await this.columnRepository.create({
        boardId,
        title: sourceColumn.title,
        color: null,
        order: index
      } as any);
      mappedColumns.push(createdColumn);
      summary.columnsCreated++;
    }

    if (!dryRun) {
      const orderedColumns = [...mappedColumns, ...extraColumns];
      for (let index = 0; index < orderedColumns.length; index++) {
        orderedColumns[index].order = index;
        await orderedColumns[index].save();
      }
    }

    return mappedColumns;
  }

  private async createTopLevelTask(
    projectId: number,
    columnId: number,
    createdById: number,
    sourceTask: HulyTask
  ): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const taskNumber = await this.reserveNextTaskNumber(
        projectId,
        transaction
      );

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
          taskNumber,
          title: sourceTask.title,
          description: sourceTask.description || '',
          priority: '',
          approvalStatus: '',
          dueDate: null,
          columnId,
          parentTaskId: null,
          order: 0,
          createdById
        } as any,
        { transaction }
      );

      await transaction.commit();
      return task;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async createSubtask(
    projectId: number,
    parentId: number,
    createdById: number,
    sourceTask: HulyTask
  ): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const parent = await this.taskRepository.findByPk(parentId, {
        transaction
      });
      if (!parent) {
        throw new Error(`Родительская задача ${parentId} не найдена`);
      }

      const taskNumber = await this.reserveNextTaskNumber(
        projectId,
        transaction
      );
      const task = await this.taskRepository.create(
        {
          taskNumber,
          title: sourceTask.title,
          description: sourceTask.description || '',
          priority: '',
          approvalStatus: '',
          dueDate: null,
          columnId: parent.columnId,
          parentTaskId: parent.id,
          order: 0,
          createdById
        } as any,
        { transaction }
      );

      await transaction.commit();
      return task;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async reserveNextTaskNumber(
    projectId: number,
    transaction: Transaction
  ): Promise<number> {
    const project = await this.projectRepository.findByPk(projectId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!project) {
      throw new Error(
        `Проект ${projectId} не найден при резервировании номера`
      );
    }

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

    const taskNumber =
      Math.max(
        Number(project.taskCounter) || 0,
        Number(maximum?.maxTaskNumber) || 0
      ) + 1;
    project.taskCounter = taskNumber;
    await project.save({ transaction });

    return taskNumber;
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule,
    SequelizeModule.forRootAsync(getSequelizeConfig({})),
    SequelizeModule.forFeature([Project, Board, BoardColumn, Task])
  ],
  providers: [HulyBoardImportRunner]
})
class HulyImportModule {}

function parseArgs(): ImportArgs {
  const logger = new Logger('ImportHulyBoard');
  const args = process.argv.slice(2);

  const projectIdArg = args.find(arg => arg.startsWith('--projectId='));
  const boardIdArg = args.find(arg => arg.startsWith('--boardId='));
  const hulyBoardIdArg = args.find(arg => arg.startsWith('--hulyBoardId='));
  const hulyBoardUrlArg = args.find(arg => arg.startsWith('--hulyBoardUrl='));
  const userIdArg = args.find(arg => arg.startsWith('--userId='));
  const dryRun = args.includes('--dry');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    logger.log('Использование:');
    logger.log(
      '  npm run import:huly-board -- --projectId=1 --boardId=2 --hulyBoardId=HULY'
    );
    logger.log(
      '  npm run import:huly-board -- --projectId=1 --boardId=2 --hulyBoardUrl=https://huly.example/ws1/tracker/HULY'
    );
    logger.log('');
    logger.log(
      'Env: HULY_BASE_URL или HULY_URL, HULY_WORKSPACE, HULY_TOKEN либо HULY_EMAIL/HULY_PASSWORD'
    );
    process.exit(0);
  }

  if (!projectIdArg || !boardIdArg || (!hulyBoardIdArg && !hulyBoardUrlArg)) {
    logger.error(
      'Нужно указать --projectId, --boardId и один из --hulyBoardId/--hulyBoardUrl'
    );
    process.exit(1);
  }

  const projectId = Number(projectIdArg.split('=').slice(1).join('='));
  const boardId = Number(boardIdArg.split('=').slice(1).join('='));
  const userId = userIdArg
    ? Number(userIdArg.split('=').slice(1).join('='))
    : undefined;

  if (!Number.isInteger(projectId) || !Number.isInteger(boardId)) {
    logger.error('--projectId и --boardId должны быть числами');
    process.exit(1);
  }

  if (userIdArg && !Number.isInteger(userId)) {
    logger.error('--userId должен быть числом');
    process.exit(1);
  }

  return {
    projectId,
    boardId,
    hulyBoardId: hulyBoardIdArg?.split('=').slice(1).join('='),
    hulyBoardUrl: hulyBoardUrlArg?.split('=').slice(1).join('='),
    userId,
    dryRun
  };
}

async function main() {
  const logger = new Logger('ImportHulyBoard');
  const args = parseArgs();
  const app = await NestFactory.createApplicationContext(HulyImportModule);

  try {
    const runner = app.get(HulyBoardImportRunner);
    const summary = await runner.run(args);

    logger.log('');
    logger.log('═══════════════════════════════════════');
    logger.log(`  Колонки создано:  ${summary.columnsCreated}`);
    logger.log(`  Колонки reused:   ${summary.columnsReused}`);
    logger.log(`  Задачи создано:   ${summary.topLevelCreated}`);
    logger.log(`  Подзадачи:        ${summary.subtasksCreated}`);
    logger.log(`  Пропущено:        ${summary.skippedSubtasks}`);
    logger.log(`  Ошибок:           ${summary.errors.length}`);
    if (summary.errors.length) {
      summary.errors.forEach(error => logger.warn(`  - ${error}`));
    }
    logger.log('═══════════════════════════════════════');
  } finally {
    await app.close();
  }
}

main().catch(error => {
  const logger = new Logger('ImportHulyBoard');
  logger.error(
    `Импорт завершился с ошибкой: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
