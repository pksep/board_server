import { performance } from 'perf_hooks';
import { Logger } from '@nestjs/common';
import { ICommandLogger } from './interface';
import { CommandMetadata } from 'nest-commander';
const Listr = require('listr');
const ansiColors = require('ansi-colors');

export class CommandLogger implements ICommandLogger {
  private _startTime: number;
  private _baseLogger: Logger;
  private _tasks: any;

  constructor(
    private readonly _config: CommandMetadata,
    startDescription?: string
  ) {
    this._baseLogger = new Logger(this._config.name);
    this.printCommandHeader(_config);
    this.start(startDescription);
  }

  get oraInstance(): any {
    return this._tasks;
  }

  private printCommandHeader(config: CommandMetadata): void {
    console.log(
      `${ansiColors.bold.cyan(config.name)}\n${ansiColors.dim(config.description)}`
    );
  }

  start(
    description = 'Начало выполнения скрипта',
    timeRefresh?: boolean
  ): void {
    if (!this._startTime || timeRefresh) this._startTime = performance.now();

    this._tasks = new Listr([
      {
        title: description,
        task: () => new Promise(resolve => setTimeout(resolve, 100))
      }
    ]);

    this._tasks.run();
  }

  done(description = 'Скрипт завершен!'): void {
    if (!this._tasks) return;

    const endTime = performance.now();
    const executionTime = (endTime - this._startTime) / 1000;

    const timeDescription = `[Время выполнения: ${executionTime.toFixed(2)} сек]`;
    console.log(`${description} ${ansiColors.dim(timeDescription)}`);
  }

  fail(description = 'Произошла критическая ошибка'): void {
    if (this._tasks) {
      console.log(`${ansiColors.red('✖')} ${description}`);
      this._tasks.done();
    }
  }

  error(...optionalParams: unknown[]): void {
    this._baseLogger.error(optionalParams);
  }

  debug(...optionalParams: unknown[]): void {
    this._baseLogger.debug(optionalParams);
  }

  fatal(...optionalParams: unknown[]): void {
    this._baseLogger.fatal(optionalParams);
  }

  warn(...optionalParams: unknown[]): void {
    this._baseLogger.warn(optionalParams);
  }

  log(...optionalParams: unknown[]): void {
    this._baseLogger.log(optionalParams);
  }

  verbose(...optionalParams: unknown[]): void {
    this._baseLogger.verbose(optionalParams);
  }
}
