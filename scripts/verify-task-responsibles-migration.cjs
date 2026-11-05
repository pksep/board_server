const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const fields = require('../migrations/2026/05.11.2026/20261105120000-add-task-responsibles-and-time-norm');
const statuses = require('../migrations/2026/05.11.2026/20261105121000-merge-completed-and-review-column-statuses');

/** @returns {Promise<void>} Проверяет реальные миграции только в собственной временной базе. */
async function verify() {
  const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
  assert.match(
    new URL(databaseUrl).pathname,
    /^\/board_archive_test_[a-z0-9_]+$/
  );
  const database = `board_archive_test_roles_${randomUUID().replaceAll('-', '')}`;
  const admin = new Sequelize(databaseUrl, {
    logging: false,
    pool: { max: 1, min: 0 }
  });
  const testUrl = new URL(databaseUrl);
  testUrl.pathname = '/' + database;
  const sequelize = new Sequelize(testUrl.href, {
    logging: false,
    pool: { max: 1, min: 0 }
  });

  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    const query = sequelize.getQueryInterface();
    await query.createTable('tasks', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      title: { type: DataTypes.STRING },
      controller_ids: { type: DataTypes.ARRAY(DataTypes.INTEGER) },
      deletedAt: { type: DataTypes.DATE }
    });
    await query.createTable('board_columns', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      status: { type: DataTypes.STRING, allowNull: true },
      deletedAt: { type: DataTypes.DATE }
    });
    await sequelize.query(
      "INSERT INTO tasks VALUES (1, 'Active', ARRAY[7], NULL), (2, 'Archived', ARRAY[9], NOW()); INSERT INTO board_columns VALUES (1, 'in_review', NULL), (2, 'completed', NULL), (3, NULL, NULL), (4, 'in_review', NOW()), (5, 'queued', NULL)"
    );
    await fields.up(query, DataTypes);
    await fields.up(query, DataTypes);
    const rows = await sequelize.query(
      'SELECT title, controller_ids, responsible_ids, time_norm_minutes FROM tasks ORDER BY id',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(rows, [
      {
        title: 'Active',
        controller_ids: [7],
        responsible_ids: [],
        time_norm_minutes: null
      },
      {
        title: 'Archived',
        controller_ids: [9],
        responsible_ids: [],
        time_norm_minutes: null
      }
    ]);
    await sequelize.query(
      'UPDATE tasks SET responsible_ids = ARRAY[7,9], time_norm_minutes = 90 WHERE id = 1'
    );
    await assert.rejects(
      sequelize.query('UPDATE tasks SET time_norm_minutes = 0 WHERE id = 1')
    );
    await assert.rejects(
      sequelize.query(
        'UPDATE tasks SET responsible_ids = ARRAY[NULL]::integer[] WHERE id = 1'
      )
    );
    await statuses.up(query);
    await statuses.up(query);
    const readStatuses = async () =>
      (
        await sequelize.query('SELECT status FROM board_columns ORDER BY id', {
          type: QueryTypes.SELECT
        })
      ).map(row => row.status);
    assert.deepEqual(await readStatuses(), [
      'completed',
      'completed',
      null,
      'completed',
      'queued'
    ]);
    // Изменённая после объединения колонка сохраняет новый выбранный тип при откате.
    await sequelize.query(
      "UPDATE board_columns SET status = 'queued' WHERE id = 4"
    );
    await statuses.down(query);
    assert.deepEqual(await readStatuses(), [
      'in_review',
      'completed',
      null,
      'queued',
      'queued'
    ]);
    await fields.down(query);
    const remaining = await query.describeTable('tasks');
    assert.equal(remaining.responsible_ids, undefined);
    assert.equal(remaining.time_norm_minutes, undefined);
    assert.equal(
      await sequelize
        .query('SELECT id FROM tasks', { type: QueryTypes.SELECT })
        .then(records => records.length),
      2
    );
    console.log('Responsible, norm and merged status migrations verified');
  } finally {
    await sequelize.close();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.close();
  }
}

verify().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
