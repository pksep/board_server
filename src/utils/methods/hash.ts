import { createHash } from 'crypto';
import { createReadStream } from 'fs';

export enum HashType {
  md5 = 'md5',
  sha256 = 'sha256'
}

/**
 * Вычисляет хеш для файла
 * @param filePath
 * @param hashType
 * @returns
 */
export function calculateHash(
  filePath: string,
  hashType?: HashType
): Promise<string>;

/**
 * Вычисляет хеш для буфера
 * @param buffer
 * @param hashType
 * @returns
 */
export function calculateHash(
  buffer: Buffer,
  hashType?: HashType
): Promise<string>;

export async function calculateHash(
  input: string | Buffer,
  hashType: HashType = HashType.sha256
): Promise<string> {
  if (typeof input === 'string') {
    return new Promise((resolve, reject) => {
      const hash = createHash(hashType);
      const stream = createReadStream(input);

      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }

  const hash = createHash(hashType);
  hash.update(input);
  return hash.digest('hex');
}
