import { Global, Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { AuthModule } from '../auth/auth.module';
import { SequelizeModule } from '@nestjs/sequelize';
import { Board } from '../boards/model/board.model';
import { ProjectsModule } from '../projects/projects.module';

@Global()
@Module({
  imports: [AuthModule, SequelizeModule.forFeature([Board]), ProjectsModule],
  providers: [WsGateway],
  exports: [WsGateway]
})
export class WsModule {}
