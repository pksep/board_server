import { Inject, Injectable } from '@nestjs/common';
import { Client } from 'minio';
import { ConfigService } from '@nestjs/config';
import { S3_PROVIDE_NAME } from './s3.constants';
import { ConfigConstains } from 'src/configs/env.config';
import mime from 'mime';
import { calculateHash } from 'src/utils/methods/hash';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Request } from 'express';

export interface IPutObjectResponse {
  objectName: string;
  hash: string;
  etag: string;
}

export interface IPresignedUploadResponse {
  presignedUrl: string;
  publicUrl: string;
  objectName: string;
}

@Injectable()
export class S3Service {
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;
  // Для локальной сети
  private readonly localBaseUrl: string;
  private readonly offlineHosts: string[];
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly isPathStyle: boolean;

  constructor(
    @Inject(S3_PROVIDE_NAME) private readonly s3Client: Client,
    private readonly configService: ConfigService
  ) {
    this.bucketName = this.configService.get<string>(
      ConfigConstains.minio.bucketName
    );
    const OFFLINE_HOSTS =
      this.configService
        .get<string>(ConfigConstains.erpClientOfflineHost)
        ?.split(',') ?? [];
    this.offlineHosts = OFFLINE_HOSTS;

    this.publicBaseUrl = this.configService.get<string>(
      ConfigConstains.minio.publicBaseUrl
    );

    this.localBaseUrl = this.configService.get<string>(
      ConfigConstains.minio.localBaseUrl
    );

    this.accessKey = this.configService.get<string>(ConfigConstains.minio.user);
    this.secretKey = this.configService.get<string>(
      ConfigConstains.minio.password
    );
    this.isPathStyle =
      this.configService.get<string>(ConfigConstains.minio.isPathStyle) ===
      'true';
  }

  /**
   * objectName обязательно с расширением!
   * @param objectName
   * @param buffer
   * @param contentType
   * @returns
   */
  async putObject(
    objectName: string,
    buffer: Buffer,
    contentType?: string
  ): Promise<IPutObjectResponse> {
    const mimeType = mime.getType(objectName) || 'application/octet-stream';
    const hash = await calculateHash(buffer);

    const result = await this.s3Client.putObject(
      this.bucketName,
      objectName,
      buffer,
      buffer.length,
      {
        'Content-Type': contentType ?? mimeType,
        'x-amz-meta-hash': hash
      }
    );

    return { objectName, hash, etag: result.etag };
  }

  async getObject(objectName: string) {
    return this.s3Client.getObject(this.bucketName, objectName);
  }

  async removeObject(objectName: string) {
    return this.s3Client.removeObject(this.bucketName, objectName);
  }

  async listObjects(prefix = '') {
    return this.s3Client.listObjects(this.bucketName, prefix, true);
  }

  async exists(objectName: string): Promise<boolean> {
    try {
      await this.s3Client.statObject(this.bucketName, objectName);
      return true;
    } catch (err: any) {
      if (['NoSuchKey', 'NotFound'].includes(err.code)) {
        return false;
      }
      throw err;
    }
  }

  async getSignedUrl(
    objectName: string,
    downloadName?: string,
    expiry = 24 * 60 * 60
  ): Promise<string> {
    return this.s3Client.presignedGetObject(
      this.bucketName,
      objectName,
      expiry,
      downloadName
        ? {
            'response-content-disposition': `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
          }
        : undefined
    );
  }

  async getPresignedPutUrl(
    objectName: string,
    req?: Request,
    expiry = 60 * 60
  ): Promise<string> {
    const uploadBaseUrl = this.resolveAccessibleBaseUrl(req);
    const region = await this.s3Client.getBucketRegionAsync(this.bucketName);
    const uploadClient = this.createUploadClient(uploadBaseUrl, region);

    return uploadClient.presignedPutObject(this.bucketName, objectName, expiry);
  }

  /**
   * Создаёт адреса для прямой загрузки контента задачи в настроенный бакет.
   * В описание задачи возвращается только постоянный публичный URL.
   */
  async createPresignedUpload(
    fileName: string,
    mimeType: string,
    req?: Request
  ): Promise<IPresignedUploadResponse> {
    const fileExtension = extname(fileName).toLowerCase();
    const mimeExtension = mime.getExtension(mimeType);
    const safeExtension = /^\.[a-z0-9]{1,10}$/i.test(fileExtension)
      ? fileExtension
      : mimeExtension
        ? `.${mimeExtension}`
        : '.bin';
    const objectName = `task-content/${uuidv4()}${safeExtension}`;
    const presignedUrl = await this.getPresignedPutUrl(objectName, req);

    return {
      presignedUrl,
      publicUrl: this.getPublicUrl(objectName, req),
      objectName
    };
  }

  getPublicUrl(objectName: string, req?: Request): string {
    return `${this.resolveAccessibleBaseUrl(req)}/${this.bucketName}/${objectName}`;
  }

  /**
   * Выбирает адрес MinIO, доступный из браузера текущего пользователя.
   */
  private resolveAccessibleBaseUrl(req?: Request): string {
    if (!this.publicBaseUrl)
      throw new Error('Public base URL is not configured!');

    if (this.offlineHosts.length && req) {
      const forwarded = req.headers['x-forwarded-host']
        ?.toString()
        .split(',')[0]
        .trim();

      const hostHeader = Array.isArray(req.headers['host'])
        ? req.headers['host'][0]
        : req.headers['host'];

      const host = forwarded || hostHeader?.split(':')[0];

      if (host && this.offlineHosts.includes(host)) {
        if (!this.localBaseUrl)
          throw new Error('Local base URL is not configured!');

        return this.localBaseUrl.replace(/\/+$/, '');
      }
    }

    return this.publicBaseUrl.replace(/\/+$/, '');
  }

  /**
   * Создаёт подписывающий клиент для того же адреса, куда загружает браузер.
   */
  private createUploadClient(baseUrl: string, region: string): Client {
    if (!this.accessKey || !this.secretKey)
      throw new Error('MinIO credentials are not configured!');

    const url = new URL(baseUrl);
    if (url.pathname !== '/' && url.pathname !== '')
      throw new Error('MinIO base URL must not contain a path!');

    const useSSL = url.protocol === 'https:';
    if (!useSSL && url.protocol !== 'http:')
      throw new Error('MinIO base URL must use HTTP or HTTPS!');

    return new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : useSSL ? 443 : 80,
      useSSL,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      pathStyle: this.isPathStyle,
      region
    });
  }
}
