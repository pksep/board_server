const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const migration = require('../migrations/2026/16.10.2026/20261016120000-add-task-controllers');

/** Проверяет перенос данных в собственной схеме только выделенной тестовой базы. */
async function verify() {
  const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
  assert.match(
    new URL(databaseUrl).pathname,
    /^\/board_archive_test_[a-z0-9_]+$/
  );
  const schema = `board_archive_test_controllers_${randomUUID().replaceAll('-', '')}`;
  const admin = new Sequelize(databaseUrl, {
    logging: false,
    pool: { max: 1, min: 0 }
  });
  const testUrl = new URL(databaseUrl);
  testUrl.pathname = '/' + schema;
  const sequelize = new Sequelize(testUrl.href, {
    logging: false,
    pool: { max: 1, min: 0 }
  });
  try {
    await admin.query(`CREATE DATABASE "${schema}"`);

    const query = sequelize.getQueryInterface();
    await query.createTable('tasks', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      created_by_id: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING },
      deletedAt: { type: DataTypes.DATE }
    });
    await sequelize.query(
      `INSERT INTO tasks (id, created_by_id, title, "deletedAt") VALUES (1, 7, 'Active', NULL), (2, 9, 'Archived', NOW())`
    );
    await migration.up(query, DataTypes);
    const rows = await sequelize.query(
      'SELECT controller_ids FROM tasks ORDER BY id',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(
      rows.map(row => row.controller_ids),
      [[7], [9]]
    );
    for (const value of [
      'ARRAY[]::integer[]',
      'NULL',
      'ARRAY[NULL]::integer[]',
      'ARRAY[0]'
    ]) {
      await assert.rejects(
        sequelize.query(
          `UPDATE tasks SET controller_ids = ${value} WHERE id = 1`
        )
      );
    }
    await sequelize.query(
      'UPDATE tasks SET controller_ids = ARRAY[11, 12] WHERE id = 1'
    );
    await migration.up(query, DataTypes);
    const changed = await sequelize.query(
      'SELECT controller_ids, created_by_id, title FROM tasks WHERE id = 1',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(changed[0], {
      controller_ids: [11, 12],
      created_by_id: 7,
      title: 'Active'
    });
    await migration.down(query);
    assert.equal(
      (await query.describeTable('tasks')).controller_ids,
      undefined
    );
    assert.equal(
      (
        await sequelize.query('SELECT * FROM tasks', {
          type: QueryTypes.SELECT
        })
      ).length,
      2
    );
    console.log('Controller migration verified');
  } finally {
    assert.match(schema, /^board_archive_test_controllers_[a-f0-9]{32}$/);
    await sequelize.close();
    await admin.query(`DROP DATABASE IF EXISTS "${schema}" WITH (FORCE)`);
    await admin.close();
  }
}

verify().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
