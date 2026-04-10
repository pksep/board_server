import { Global, Module, DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { S3Service } from './s3.service';
import { ConfigConstains } from 'src/configs/env.config';
import * as dotenv from 'dotenv';
import { S3MockService } from './s3.mock.service';
import { S3Controller } from './s3.controller';

import { S3_PROVIDE_NAME } from './s3.constants';

dotenv.config({
  path: `env/.${process.env.NODE_ENV}.env`
});

const noRunMode = process.env.MINIO_DISABLED === 'true';

@Module({})
@Global()
export class S3Module {
  static forRootAsync(): DynamicModule {
    return {
      module: S3Module,
      imports: [ConfigModule],
      controllers: [S3Controller],
      providers: [
        ...(!noRunMode
          ? [
              {
                provide: S3_PROVIDE_NAME,
                useFactory: async (config: ConfigService): Promise<Client> => {
                  try {
                    const endpoint = config.get<string>(
                      ConfigConstains.minio.endpoint
                    );
                    const port = config.get<number>(ConfigConstains.minio.port);
                    const useSSL = config.get<string>(
                      ConfigConstains.minio.ssl
                    );
                    const accessKey = config.get<string>(
                      ConfigConstains.minio.user
                    );
                    const secretKey = config.get<string>(
                      ConfigConstains.minio.password
                    );
                    const bucketName = config.get<string>(
                      ConfigConstains.minio.bucketName
                    );
                    const isPathStyle = config.get<string>(
                      ConfigConstains.minio.isPathStyle
                    );

                    if (
                      !endpoint ||
                      !port ||
                      !accessKey ||
                      !secretKey ||
                      !bucketName
                    )
                      throw new Error('MinIO config variables are missing!');

                    const client = new Client({
                      endPoint: endpoint,
                      port,
                      useSSL: useSSL === 'true',
                      accessKey,
                      secretKey,
                      pathStyle: isPathStyle === 'true'
                    });

                    const exists = await client.bucketExists(bucketName);
                    if (!exists) {
                      await client.makeBucket(bucketName, 'sep-1');
                    }

                    const policy = {
                      Version: '2012-10-17',
                      Statement: [
                        {
                          Effect: 'Allow',
                          Principal: { AWS: ['*'] },
                          Action: ['s3:GetObject'],
                          Resource: [`arn:aws:s3:::${bucketName}/*`]
                        }
                      ]
                    };
                    await client.setBucketPolicy(
                      bucketName,
                      JSON.stringify(policy)
                    );

                    return client;
                  } catch (error: any) {
                    console.error('Error creating MinIO client:', error);
                    throw error;
                  }
                },
                inject: [ConfigService]
              },
              {
                provide: S3Service,
                useFactory: (client: Client, config: ConfigService) =>
                  new S3Service(client, config),
                inject: [S3_PROVIDE_NAME, ConfigService]
              }
            ]
          : [
              {
                provide: S3Service,
                useClass: noRunMode ? S3MockService : S3Service
              }
            ])
      ],

      exports: [S3Service]
    };
  }
}
