import { ConfigConstains } from 'src/configs/env.config';
import { S3Service } from '../s3.service';

describe('S3Service.createPresignedUpload', () => {
  const createService = () => {
    const client = {
      presignedPutObject: jest.fn().mockResolvedValue('https://signed.example')
    };
    const values = new Map<unknown, string>([
      [ConfigConstains.minio.bucketName, 'board-prod'],
      [ConfigConstains.erpClientOfflineHost, ''],
      [ConfigConstains.minio.publicBaseUrl, 'https://minio.example/'],
      [ConfigConstains.minio.localBaseUrl, 'http://minio:9000']
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

    const result = await service.createPresignedUpload('demo.MP4', 'video/mp4');

    expect(result.objectName).toMatch(/^task-content\/[0-9a-f-]{36}\.mp4$/);
    expect(result.presignedUrl).toBe('https://signed.example');
    expect(result.publicUrl).toBe(
      `https://minio.example/board-prod/${result.objectName}`
    );
    expect(client.presignedPutObject).toHaveBeenCalledWith(
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
});
