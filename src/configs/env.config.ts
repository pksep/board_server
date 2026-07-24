import { generateObjectPath } from '../utils/extensions/objects';

export type ConfigType = ReturnType<typeof configFactory>;

export default function configFactory() {
  return {
    port: process.env.PORT!,
    allowedOrigin: process.env.ALLOWED_ORIGIN,
    database: {
      url: process.env.DATABASE_URL!,
      timeout: Number(process.env.CONNECT_TIMEOUT) || 120000
    },
    privateKey: process.env.PRIVATE_KEY!,
    redisUrl: process.env.REDIS_URL!,
    adminPassword: process.env.ADMIN_PASSWORD!,
    applicationType: process.env.APPLICATION_TYPE!,
    erpClientOfflineHost: process.env.ERP_CLIENT_OFFLINE_HOST!,
    erpApiUrl: process.env.ERP_API_URL || '',
    minio: {
      user: process.env.MINIO_ROOT_USER!,
      password: process.env.MINIO_ROOT_PASSWORD!,
      bucketName: process.env.MINIO_BUCKET_NAME!,
      endpoint: process.env.MINIO_ENDPOINT!,
      port: process.env.MINIO_PORT!,
      ssl: process.env.MINIO_USE_SSL!,
      publicBaseUrl: process.env.MINIO_PUBLIC_BASE_URL!,
      isPathStyle: process.env.MINIO_PATH_STYLE!,
      localBaseUrl: process.env.MINIO_LOCAL_BASE_URL!
    },
    compressionThresold: Number(process.env.COMPRESSION_THRESHOLD) || 1024,
    commentService: {
      url: process.env.COMMENTS_SERVICE_URL!
    },
    mcpProjects: {
      audience: process.env.MCP_PROJECTS_AUDIENCE || 'board-projects-mcp',
      resourceUrl: process.env.MCP_PROJECTS_RESOURCE_URL || '',
      introspectionUrl: process.env.MCP_PROJECTS_INTROSPECTION_URL || '',
      authorizationServerUrl: process.env.MCP_AUTH_ISSUER || ''
    }
  } as const;
}

export const ConfigConstains = generateObjectPath(configFactory());
