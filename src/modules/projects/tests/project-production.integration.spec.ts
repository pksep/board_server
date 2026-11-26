import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Attributes, DataTypes, Model } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import models from '../../../configs/models';
import { User } from '../../users/model/users.model';
import { ProjectTag } from '../../tags/model/project-tag.model';
import { Board } from '../../boards/model/board.model';
import { BoardColumn } from '../../columns/model/board-column.model';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { Project } from '../model/project.model';
import { ProjectMember } from '../model/project-member.model';
import { UserFavorite } from '../model/user-favorite.model';
import { ProjectAccessService } from '../project-access.service';
import { ProjectsService } from '../projects.service';
import type { IProjectProductionMigration } from './interface/project-production-migration';

const migration: IProjectProductionMigration = require('../../../../migrations/2026/16.11.2026/20261116120000-add-project-show-in-production');
const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Записывает данные только в собственную тестовую базу через настоящие модели. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

describeWithDatabase(
  'Project production setting with isolated PostgreSQL',
  (): void => {
    let database: Sequelize;
    let service: ProjectsService;
    let owner: User;
    let member: User;
    let outsider: User;
    let legacyProject: Project;
    let enabledProjectId: number;

    beforeAll(async (): Promise<void> => {
      if (
        !/^\/board_archive_test_[a-z0-9_]+$/.test(
          new URL(databaseUrl!).pathname
        )
      ) {
        throw new Error(
          'Project settings require an isolated board_archive_test_* database'
        );
      }

      // Как в проверке смены аккаунта, сохраняем идентичность настоящих моделей при resetModules.
      jest.doMock('../model/project-member.model', () => ({ ProjectMember }));
      jest.doMock('../model/user-favorite.model', () => ({ UserFavorite }));
      jest.doMock('../../tags/model/project-tag.model', () => ({ ProjectTag }));

      database = new Sequelize(databaseUrl!, {
        dialect: 'postgres',
        models,
        logging: false,
        pool: { max: 2, min: 0 }
      });
      await database.sync();
      owner = await persist(User.build(), {
        initial: 'Production Owner',
        login: 'Production Owner',
        serviceNumber: 'production-owner'
      });
      member = await persist(User.build(), {
        initial: 'Production Member',
        login: 'Production Member',
        serviceNumber: 'production-member'
      });
      outsider = await persist(User.build(), {
        initial: 'Production Outsider',
        login: 'Production Outsider',
        serviceNumber: 'production-outsider'
      });
      legacyProject = await persist(Project.build(), {
        title: 'Existing production project',
        prefix: 'LEGACYPRD',
        createdById: owner.id
      });

      // Старые проекты не получают включённый признак при обновлении схемы.
      await database
        .getQueryInterface()
        .removeColumn('projects', 'show_in_production');
      await migration.up(database.getQueryInterface(), DataTypes);
      service = new ProjectsService(
        Project,
        ProjectMember,
        UserFavorite,
        database,
        new ProjectAccessService(Project, ProjectMember)
      );
    });

    afterAll(async (): Promise<void> => {
      await database?.close();
    });

    it('defaults existing and newly created projects to false', async (): Promise<void> => {
      expect(
        (await service.getById(legacyProject.id, owner.id)).showInProduction
      ).toBe(false);
      const created = await service.create(
        { title: 'Default production project', prefix: 'DEFAULTPRD' },
        owner.id
      );
      expect(created.showInProduction).toBe(false);
    });

    it('persists explicit true in creation and both values in updates', async (): Promise<void> => {
      const project = await service.create(
        {
          title: 'Enabled production project',
          prefix: 'ENABLEPRD',
          membersIds: [member.id],
          showInProduction: true
        },
        owner.id
      );
      enabledProjectId = project.id;
      expect(project.showInProduction).toBe(true);
      expect(
        (await service.getById(project.id, member.id)).showInProduction
      ).toBe(true);
      await service.update(
        { id: project.id, title: 'Renamed production project' },
        owner.id
      );
      expect(
        (await service.getById(project.id, owner.id)).showInProduction
      ).toBe(true);
      await migration.up(database.getQueryInterface(), DataTypes);
      expect(
        (await service.getById(project.id, owner.id)).showInProduction
      ).toBe(true);
      await service.update(
        { id: project.id, showInProduction: false },
        owner.id
      );
      expect(
        (await service.getAll(owner.id)).find(item => item.id === project.id)
          ?.showInProduction
      ).toBe(false);
      await service.update(
        { id: project.id, showInProduction: true },
        owner.id
      );
      expect(
        (await service.getById(project.id, owner.id)).showInProduction
      ).toBe(true);
    });

    it('keeps project management restricted to its owner', async (): Promise<void> => {
      await expect(
        service.update(
          { id: enabledProjectId, showInProduction: false },
          member.id
        )
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.update(
          { id: enabledProjectId, showInProduction: false },
          outsider.id
        )
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await service.getById(enabledProjectId, owner.id)).showInProduction
      ).toBe(true);
    });

    it('persists task permissions and rejects references outside the project', async (): Promise<void> => {
      const board = await persist(Board.build(), {
        projectId: enabledProjectId,
        title: 'Rules'
      });
      const column = await persist(BoardColumn.build(), {
        boardId: board.id,
        title: 'Allowed'
      });
      const foreign = await persist(Board.build(), {
        projectId: legacyProject.id,
        title: 'Other'
      });
      const foreignColumn = await persist(BoardColumn.build(), {
        boardId: foreign.id,
        title: 'Other'
      });
      const taskPermissions = {
        assignee: {
          moveToColumnIds: [column.id],
          moveFromColumnIds: [],
          canEditAttributes: true
        },
        controller: { canEditAttributes: false },
        createRules: [{ userIds: [member.id], columnIds: [column.id] }]
      };
      await expect(
        service.update({ id: enabledProjectId, taskPermissions }, member.id)
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await service.update(
            { id: enabledProjectId, taskPermissions },
            owner.id
          )
        ).taskPermissions
      ).toEqual(taskPermissions);
      await expect(
        service.update(
          {
            id: enabledProjectId,
            taskPermissions: {
              controller: { moveToColumnIds: [foreignColumn.id] }
            }
          },
          owner.id
        )
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.update(
          {
            id: enabledProjectId,
            taskPermissions: {
              createRules: [{ userIds: [outsider.id], columnIds: [column.id] }]
            }
          },
          owner.id
        )
      ).rejects.toMatchObject({ status: 400 });
      expect(
        (await service.getById(enabledProjectId, owner.id)).taskPermissions
      ).toEqual(taskPermissions);
      expect(
        (
          await service.update(
            { id: enabledProjectId, taskPermissions: null },
            owner.id
          )
        ).taskPermissions
      ).toBeNull();
    });

    it('persists separate board rules and rejects other boards, columns and duplicate scopes', async (): Promise<void> => {
      const board = await persist(Board.build(), {
        projectId: enabledProjectId,
        title: 'Policy board'
      });
      const other = await persist(Board.build(), {
        projectId: enabledProjectId,
        title: 'Another board'
      });
      const foreign = await persist(Board.build(), {
        projectId: legacyProject.id,
        title: 'Foreign board'
      });
      const col = await persist(BoardColumn.build(), {
        boardId: board.id,
        title: 'Own column'
      });
      const otherCol = await persist(BoardColumn.build(), {
        boardId: other.id,
        title: 'Another column'
      });
      const taskPermissions = {
        controller: { canEditAttributes: false },
        boards: [
          {
            boardId: board.id,
            responsible: { moveToColumnIds: [col.id] },
            createRules: [{ userIds: [owner.id], columnIds: [col.id] }]
          },
          { boardId: other.id }
        ]
      };
      await service.update({ id: enabledProjectId, taskPermissions }, owner.id);
      expect(
        (await service.getById(enabledProjectId, owner.id)).taskPermissions
      ).toEqual(taskPermissions);

      for (const boards of [
        [{ boardId: foreign.id }],
        [{ boardId: board.id }, { boardId: board.id }],
        [
          {
            boardId: board.id,
            controller: { moveFromColumnIds: [otherCol.id] }
          }
        ],
        [
          {
            boardId: board.id,
            createRules: [{ userIds: [owner.id], columnIds: [otherCol.id] }]
          }
        ]
      ]) {
        await expect(
          service.update(
            { id: enabledProjectId, taskPermissions: { boards } },
            owner.id
          )
        ).rejects.toMatchObject({ status: 400 });
      }
      expect(
        (await service.getById(enabledProjectId, owner.id)).taskPermissions
      ).toEqual(taskPermissions);
    });

    it('validates the creator list and removes members from the project and board lists', async (): Promise<void> => {
      const board = await persist(Board.build(), {
        projectId: enabledProjectId,
        title: 'Creator list'
      });
      const taskPermissions = {
        createUserIds: [owner.id, member.id],
        boards: [{ boardId: board.id, createUserIds: [member.id] }]
      };
      await service.update({ id: enabledProjectId, taskPermissions }, owner.id);
      await expect(
        service.update(
          {
            id: enabledProjectId,
            taskPermissions: {
              boards: [{ boardId: board.id, createUserIds: [outsider.id] }]
            }
          },
          owner.id
        )
      ).rejects.toMatchObject({ status: 400 });

      const updated = await service.update(
        { id: enabledProjectId, membersIds: [] },
        owner.id
      );
      expect(updated.taskPermissions).toEqual({
        createUserIds: [owner.id],
        boards: [{ boardId: board.id, createUserIds: [] }]
      });
    });

    it('validates nested task permission types, including lists of IDs', async (): Promise<void> => {
      const invalid = [
        { controller: { canEditAttributes: 'yes' } },
        { responsible: { moveFromColumnIds: [1, 1] } },
        { assignee: { moveToColumnIds: ['2'] } },
        { createRules: [{ userIds: [1], columnIds: [0] }] },
        { boards: [{ boardId: 0 }] },
        { boards: [{ boardId: 1, controller: { canEditAttributes: 'yes' } }] },
        { createUserIds: [1, 1] },
        { boards: [{ boardId: 1, createUserIds: ['1'] }] }
      ];
      for (const taskPermissions of invalid) {
        const errors = await validate(
          plainToInstance(UpdateProjectDto, {
            id: enabledProjectId,
            taskPermissions
          })
        );
        expect(errors.some(error => error.property === 'taskPermissions')).toBe(
          true
        );
      }
    });

    it('accepts booleans and rejects strings or objects in request contracts', async (): Promise<void> => {
      for (const showInProduction of [true, false]) {
        expect(
          await validate(
            plainToInstance(CreateProjectDto, {
              title: 'Validated project',
              prefix: 'VALPRD',
              showInProduction
            })
          )
        ).toHaveLength(0);
        expect(
          await validate(
            plainToInstance(UpdateProjectDto, {
              id: legacyProject.id,
              showInProduction
            })
          )
        ).toHaveLength(0);
      }
      for (const showInProduction of ['yes', 'false', 1, {}]) {
        const errors = await validate(
          plainToInstance(UpdateProjectDto, {
            id: legacyProject.id,
            showInProduction
          })
        );
        expect(
          errors.some(error => error.property === 'showInProduction')
        ).toBe(true);
      }
    });
  }
);
