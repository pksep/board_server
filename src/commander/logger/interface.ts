export interface ICommandLogger {
  start(description?: string, timeRefresh?: boolean): void;
  done(description?: string): void;
  fail(description?: string): void;
  error(...optionalParams: unknown[]): void;
  debug(...optionalParams: unknown[]): void;
  fatal(...optionalParams: unknown[]): void;
  warn(...optionalParams: unknown[]): void;
  log(...optionalParams: unknown[]): void;
  verbose(...optionalParams: unknown[]): void;
}
