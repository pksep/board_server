import { CommandFactory } from 'nest-commander';
import { CliModule } from './commander/commandr.module';

async function bootstrap() {
  console.log('SEP:COMMANDER');

  try {
    await CommandFactory.run(CliModule, {
      logger: ['debug', 'error', 'fatal', 'warn']
    });
  } finally {
    process.exit(0);
  }
}

bootstrap();
