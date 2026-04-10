import { initializeSequelize } from './db';
import { SequelizeStorage, Umzug } from 'umzug';
import _yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
const glob = require('glob');

function checkFileExists(pattern) {
  return new Promise((resolve, reject) => {
    glob(pattern, (err, matches) => {
      if (err) {
        return reject(err);
      }
      resolve(matches.length > 0);
    });
  });
}

const toEnumsCommand = ['up', 'down', 'status'];
const argv: any = _yargs(hideBin(process.argv))
  .option('to', {
    description: 'Запустить миграции',
    type: 'string',
    demandOption: true,
    choices: toEnumsCommand
  })
  .option('db_name', {
    description: 'Имя базы данных',
    type: 'string',
    demandOption: false
  })
  .option('name', {
    description: 'Имя миграции',
    type: 'string',
    demandOption: false
  })
  .check(argv => {
    return toEnumsCommand.includes(argv.to)
      ? true
      : new Error('Параметр --to должен быть либо "up", либо "down"');
  })
  .help()
  .alias('help', 'h')
  .parse();

(async () => {
  let migrationsPath = `migrations/**/**/*.js`;

  if (argv.name) {
    const pattern = `migrations/**/**/${argv.name}.js`;
    const fileExists = await checkFileExists(pattern);

    if (!fileExists) {
      console.error(`Ошибка. Файл "${argv.name}" не существует.`);
      process.exit(1);
    } else {
      migrationsPath = `migrations/**/**/${argv.name}.js`;
    }
  }

  const sequelize = initializeSequelize();

  const umzug = new Umzug({
    migrations: {
      glob: migrationsPath,
      resolve: ({ name, path, context }) => {
        const migration = require(path);

        return {
          name,
          up: async () => migration.up(context, sequelize.Sequelize),
          down: async () =>
            migration.down && migration.down(context, sequelize.Sequelize)
        };
      }
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console
  });

  try {
    if (argv.to === 'status') {
      const pendings = await umzug.pending();
      const pendingsList = pendings.map(el => `\n${el.name}`);
      const executed = await umzug.executed();
      const exexcutedList = executed.map(el => `\n${el.name}`);

      console.log(`\n\x1b[1mExecuted list:\x1b[0m`);
      console.log(...exexcutedList);

      console.log(`\n\x1b[1mPending list:\x1b[0m`);
      console.log(...pendingsList);
      return;
    }

    umzug.on('migrating', ({ name }) => {
      console.log(`\n\x1b[1mНачинается миграция для:`);
      console.log(`${name}\n`);
    });

    umzug.on('migrated', ({ name }) => {
      console.log(`\n\x1b[1mМиграция успешно завершена для: `);
      console.log(`${name}\n`);
    });

    umzug.on('reverting', ({ name }) => {
      console.log(`\n\x1b[1mНачинается откат миграции для:`);
      console.log(`${name}\n`);
    });

    umzug.on('reverted', ({ name }) => {
      console.log(`\n\x1b[1mОткат миграции успешно завершен для:`);
      console.log(`${name}\n`);
    });

    if (argv.to === 'down' && !argv.name) {
      const executedMigrations = await umzug.executed();

      if (executedMigrations.length === 0) {
        console.error(`\x1b[31mНет выполненных миграций для отката.\x1b[0m`);
        process.exit(1);
      }

      const sortedMigrations = executedMigrations.sort((a, b) => {
        const timestampA = parseInt(a.name.split('-')[0], 10);
        const timestampB = parseInt(b.name.split('-')[0], 10);
        return timestampB - timestampA;
      });

      const lastMigration = sortedMigrations[0];
      console.log(
        `\n\x1b[1mОткат последней выполненной миграции: ${lastMigration.name}\x1b[0m`
      );

      await umzug.down({ to: lastMigration.name });
    } else {
      await umzug[argv.to]();
    }
    console.log('\n');
    console.log(`\x1b[32m`, `${argv.to} successful implementation`, `\x1b[0m`);
  } catch (err) {
    console.error(`\x1b[31m`, err, `\x1b[0m`);
  }
})();
