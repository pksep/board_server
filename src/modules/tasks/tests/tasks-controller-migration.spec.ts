import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const describeWithDatabase = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('Task controller migration in a dedicated schema', () => {
  it('restores missing controllers to the project owner through repeatable migration and database writes', (): void => {
    const output = execFileSync(
      process.execPath,
      [
        resolve(
          __dirname,
          '../../../../scripts/verify-controller-owner-fallback.cjs'
        )
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    expect(output).toContain('Project owner controller fallback verified');
  });

  it('backfills authors, enforces nonempty controllers, supports repeat and rollback', (): void => {
    // Отдельный процесс проверяет миграцию без переопределений модулей Jest.
    const output = execFileSync(
      process.execPath,
      [
        resolve(
          __dirname,
          '../../../../scripts/verify-task-controllers-migration.cjs'
        )
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    expect(output).toContain('Controller migration verified');
  });
});
