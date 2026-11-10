const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, basename, resolve } = require('node:path');
const { promisify } = require('node:util');

const image =
  process.env.BOARD_MIGRATION_TEST_IMAGE || 'board-server:erp872-check';
const prefix = `board-migration-test-${process.pid}`;
const directory = mkdtempSync(join(tmpdir(), 'board-migration-test-'));
const runAsync = promisify(execFile);

/** Runs only test containers; all credentials below belong to the isolated DB. */
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** Uses the same image entrypoint as the deployment, replacing only the app. */
function startArgs(fixture, database = 'board_test') {
  return [
    'run',
    '--rm',
    '--network',
    prefix,
    '-e',
    `DATABASE_URL=postgresql://postgres:isolated-test@${prefix}/${database}`,
    '--mount',
    `type=bind,source=${join(directory, fixture)},target=/app/board_server/migrations,readonly`,
    image,
    'node',
    '-e',
    "console.log('APPLICATION_STARTED')"
  ];
}

/** Queries the dedicated PostgreSQL container without publishing its port. */
function sql(statement, database = 'board_test') {
  return docker([
    'exec',
    prefix,
    'psql',
    '-U',
    'postgres',
    '-d',
    database,
    '-Atc',
    statement
  ]).trim();
}

/** Verifies deployment failure cannot execute the application command. */
function expectFailure(args) {
  try {
    docker(args);
    assert.fail('Expected startup to fail');
  } catch (error) {
    assert.equal(error.status, 1);
    assert(!String(error.stdout).includes('APPLICATION_STARTED'));
  }
}

/** Tests real migration persistence, startup ordering, concurrency and failure. */
async function main() {
  for (const name of ['success', 'failure', 'empty'])
    mkdirSync(join(directory, name));
  writeFileSync(
    join(directory, 'success', '001-create.js'),
    `module.exports.up = async q => {
    await q.sequelize.query('SELECT pg_sleep(0.3)');
    await q.sequelize.query('CREATE TABLE deployment_probe (id integer PRIMARY KEY)');
  };`
  );
  writeFileSync(
    join(directory, 'success', '002-insert.js'),
    `module.exports.up = async q => {
    await q.sequelize.query('INSERT INTO deployment_probe VALUES (1)');
  };`
  );
  writeFileSync(
    join(directory, 'failure', '001-broken.js'),
    `module.exports.up = async () => {
    throw new Error('Deliberate deployment test failure');
  };`
  );

  try {
    docker(['network', 'create', prefix]);
    docker([
      'run',
      '-d',
      '--name',
      prefix,
      '--network',
      prefix,
      '-e',
      'POSTGRES_PASSWORD=isolated-test',
      '-e',
      'POSTGRES_DB=board_test',
      'postgres:16.4-alpine'
    ]);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        docker([
          'exec',
          prefix,
          'pg_isready',
          '-U',
          'postgres',
          '-d',
          'board_test'
        ]);
        ready = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    assert(ready, 'Isolated PostgreSQL did not become ready');

    const first = docker(startArgs('success'));
    assert(first.includes('APPLICATION_STARTED'));
    assert.equal(sql('SELECT count(*) FROM deployment_probe'), '1');
    assert.equal(sql('SELECT count(*) FROM "SequelizeMeta"'), '2');
    const repeat = docker(startArgs('success'));
    assert(repeat.includes('APPLICATION_STARTED'));
    assert.equal(sql('SELECT count(*) FROM deployment_probe'), '1');
    console.log(
      'PASS: pending migrations run before the app; repeat startup is idempotent'
    );

    sql('CREATE DATABASE board_parallel');
    const parallel = await Promise.all(
      [0, 1].map(() =>
        runAsync('docker', startArgs('success', 'board_parallel'), {
          encoding: 'utf8',
          timeout: 90000
        })
      )
    );
    assert(
      parallel.every(result => result.stdout.includes('APPLICATION_STARTED'))
    );
    assert.equal(
      sql('SELECT count(*) FROM deployment_probe', 'board_parallel'),
      '1'
    );
    console.log(
      'PASS: concurrent container starts serialize migration execution'
    );

    sql('CREATE DATABASE board_failure');
    expectFailure(startArgs('failure', 'board_failure'));
    assert.equal(
      sql('SELECT count(*) FROM "SequelizeMeta"', 'board_failure'),
      '0'
    );
    expectFailure(startArgs('empty'));
    console.log(
      'PASS: a failed or missing migration blocks application startup'
    );
  } finally {
    // These exact names were allocated by this process; no shared resources.
    for (const args of [
      ['rm', '-f', prefix],
      ['network', 'rm', prefix]
    ]) {
      try {
        docker(args);
      } catch {
        /* Preserve the original verification error. */
      }
    }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(basename(directory).startsWith('board-migration-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message);
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  process.exitCode = 1;
});
