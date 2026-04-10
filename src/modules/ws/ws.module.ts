import { Global, Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  providers: [WsGateway],
  exports: [WsGateway]
})
export class WsModule {}
