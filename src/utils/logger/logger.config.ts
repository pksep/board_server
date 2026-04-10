import { Params } from 'nestjs-pino';
import { randomUUID } from 'crypto';

const isProd = process.env.NODE_ENV === 'production';
const ignoredEndpoints = ['/health', '/metrics', '/favicon.ico'];

const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.PINO_LOG_LEVEL || 'warn',
    formatters: {
      level: label => {
        return { level: label.toLowerCase() };
      },
      bindings: () => {
        return { node_version: process.version };
      }
    },
    serializers: {
      req: req => ({
        id: req.id,
        method: req.method,
        url: req.url
      }),
      res: res => ({
        statusCode: res.statusCode
      }),
      err: err => ({
        type: err.name,
        message: err.message,
        stack: err.stack
      })
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    genReqId: req => req.headers['x-request-id'] || randomUUID(),
    customProps: () => ({
      context: 'HTTP'
    }),
    autoLogging: {
      ignore: req => ignoredEndpoints.includes(req.url)
    },
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: { singleLine: true, colorize: true }
        },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.token',
        'body.accessToken',
        'body.refreshToken'
      ],
      remove: true
    }
  }
};

export default loggerConfig;
