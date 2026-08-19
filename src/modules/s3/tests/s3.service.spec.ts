import { ConfigConstains } from 'src/configs/env.config';
import { S3Service } from '../s3.service';
import type { Request } from 'express';

describe('S3Service.createPresignedUpload', () => {
  const createService = (offlineHosts = '') => {
    const client = {
      getBucketRegionAsync: jest.fn().mockResolvedValue('sep-1')
    };
    const values = new Map<unknown, string>([
      [ConfigConstains.minio.bucketName, 'board-prod'],
      [ConfigConstains.erpClientOfflineHost, offlineHosts],
      [ConfigConstains.minio.publicBaseUrl, 'https://minio.example/'],
      [ConfigConstains.minio.localBaseUrl, 'http://minio.local:9000/'],
      [ConfigConstains.minio.user, 'admin'],
      [ConfigConstains.minio.password, 'password'],
      [ConfigConstains.minio.isPathStyle, 'true']
    ]);
    const config = {
      get: jest.fn((key: unknown) => values.get(key))
    };

    return {
      client,
      service: new S3Service(client as never, config as never)
    };
  };

  it('выдаёт адреса одного бакета и сохраняет безопасное расширение файла', async () => {
    const { client, service } = createService();
    const presignedPutObject = jest
      .fn()
      .mockResolvedValue('https://minio.example/signed-upload');
    const createUploadClient = jest
      .spyOn(service as any, 'createUploadClient')
      .mockReturnValue({ presignedPutObject });

    const result = await service.createPresignedUpload('demo.MP4', 'video/mp4');

    expect(result.objectName).toMatch(/^task-content\/[0-9a-f-]{36}\.mp4$/);
    expect(result.presignedUrl).toBe('https://minio.example/signed-upload');
    expect(result.publicUrl).toBe(
      `https://minio.example/board-prod/${result.objectName}`
    );
    expect(client.getBucketRegionAsync).toHaveBeenCalledWith('board-prod');
    expect(createUploadClient).toHaveBeenCalledWith(
      'https://minio.example',
      'sep-1'
    );
    expect(presignedPutObject).toHaveBeenCalledWith(
      'board-prod',
      result.objectName,
      60 * 60
    );
  });

  it('определяет расширение по MIME-типу, если имя его не содержит', async () => {
    const { service } = createService();

    const result = await service.createPresignedUpload(
      'recording',
      'video/webm'
    );

    expect(result.objectName).toMatch(/^task-content\/[0-9a-f-]{36}\.webm$/);
  });

  it('подписывает локальный адрес для пользователя из offline-сети', async () => {
    const { service } = createService('board.local');
    const presignedPutObject = jest
      .fn()
      .mockResolvedValue('http://minio.local:9000/signed-upload');
    const createUploadClient = jest
      .spyOn(service as any, 'createUploadClient')
      .mockReturnValue({ presignedPutObject });
    const request = {
      headers: { host: 'board.local:8080' }
    } as unknown as Request;

    const result = await service.createPresignedUpload(
      'photo.png',
      'image/png',
      request
    );

    expect(createUploadClient).toHaveBeenCalledWith(
      'http://minio.local:9000',
      'sep-1'
    );
    expect(result.publicUrl).toBe(
      `http://minio.local:9000/board-prod/${result.objectName}`
    );
  });
});
