import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

const { ERP } = require('@pksep/contracts');

@Global()
@Module({
  imports: [
    RabbitMQModule.forRoot({
      uri: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
      exchanges: [{ name: ERP, type: 'topic' }],
      connectionInitOptions: { wait: false },
      connectionManagerOptions: {
        heartbeatIntervalInSeconds: 15,
        reconnectTimeInSeconds: 5
      }
    })
  ],
  exports: [RabbitMQModule]
})
export class RabbitMqModule {}
