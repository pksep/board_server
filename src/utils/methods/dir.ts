import * as path from 'path';

export const fullStaticPath = (filePath: string = '/') =>
  path.resolve(process.cwd(), 'dist', 'static', filePath);
