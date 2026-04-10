export function getEnvFilePaths(): string[] {
  const nodeEnv = process.env.NODE_ENV;
  const paths = ['.env'];

  if (nodeEnv) {
    paths.unshift(`env/.${nodeEnv}.env`);
  }

  return paths;
}
