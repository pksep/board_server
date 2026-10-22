const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Sequelize, DataTypes, QueryTypes } = require('sequelize');
const migration = require('../migrations/2026/21.10.2026/20261021160000-restore-missing-task-controllers');

/** @returns {Promise<void>} Проверяет восстановление только в собственной временной базе. */
async function verify() {
  const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
  assert.match(
    new URL(databaseUrl).pathname,
    /^\/board_archive_test_[a-z0-9_]+$/
  );
  const name = `board_archive_test_owner_${randomUUID().replaceAll('-', '')}`;
  const admin = new Sequelize(databaseUrl, {
    logging: false,
    pool: { max: 1, min: 0 }
  });
  const target = new URL(databaseUrl);
  target.pathname = '/' + name;
  const database = new Sequelize(target.href, {
    logging: false,
    pool: { max: 1, min: 0 }
  });

  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const query = database.getQueryInterface();
    await query.createTable('projects', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      created_by_id: DataTypes.INTEGER
    });
    await query.createTable('boards', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      project_id: DataTypes.INTEGER
    });
    await query.createTable('board_columns', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      board_id: DataTypes.INTEGER
    });
    await query.createTable('tasks', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      column_id: DataTypes.INTEGER,
      created_by_id: DataTypes.INTEGER,
      controller_ids: DataTypes.ARRAY(DataTypes.INTEGER)
    });
    await database.query(`
      INSERT INTO projects VALUES (1, 11), (2, 22);
      INSERT INTO boards VALUES (1, 1), (2, 2);
      INSERT INTO board_columns VALUES (1, 1), (2, 2);
      INSERT INTO tasks VALUES (1, 1, 7, NULL), (2, 1, 8, ARRAY[]::integer[]), (3, 2, 9, ARRAY[33]);
    `);
    await migration.up(query);
    const rows = await database.query(
      'SELECT id, created_by_id, controller_ids FROM tasks ORDER BY id',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(rows, [
      { id: 1, created_by_id: 7, controller_ids: [11] },
      { id: 2, created_by_id: 8, controller_ids: [11] },
      { id: 3, created_by_id: 9, controller_ids: [33] }
    ]);
    await database.query(
      'UPDATE tasks SET controller_ids=ARRAY[]::integer[] WHERE id=3'
    );
    await database.query(
      'INSERT INTO tasks (id, column_id, created_by_id) VALUES (4, 2, 10)'
    );
    const recovered = await database.query(
      'SELECT controller_ids FROM tasks WHERE id IN (3,4) ORDER BY id',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(
      recovered.map(row => row.controller_ids),
      [[22], [22]]
    );
    await database.query(
      'UPDATE tasks SET controller_ids=ARRAY[44] WHERE id=1'
    );
    await migration.up(query);
    const [preserved] = await database.query(
      'SELECT controller_ids FROM tasks WHERE id=1',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(preserved.controller_ids, [44]);
    for (const invalid of ['ARRAY[0]', 'ARRAY[NULL]::integer[]']) {
      await assert.rejects(
        database.query(`UPDATE tasks SET controller_ids=${invalid} WHERE id=1`)
      );
    }
    await migration.down(query);
    await migration.down(query);
    await assert.rejects(
      database.query(
        'UPDATE tasks SET controller_ids=ARRAY[]::integer[] WHERE id=1'
      )
    );
    await migration.up(query);
    await database.query('UPDATE tasks SET controller_ids=NULL WHERE id=1');
    const [restored] = await database.query(
      'SELECT controller_ids FROM tasks WHERE id=1',
      { type: QueryTypes.SELECT }
    );
    assert.deepEqual(restored.controller_ids, [11]);
    console.log('Project owner controller fallback verified');
  } finally {
    assert.match(name, /^board_archive_test_owner_[a-f0-9]{32}$/);
    await database.close();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.close();
  }
}

verify().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
