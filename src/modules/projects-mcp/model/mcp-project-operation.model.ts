import {
  Column,
  DataType,
  ForeignKey,
  Model,
  Table
} from 'sequelize-typescript';
import { Project } from 'src/modules/projects/model/project.model';
import { User } from 'src/modules/users/model/users.model';

export enum McpProjectOperationStatus {
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed'
}

@Table({
  tableName: 'mcp_project_operations',
  indexes: [
    {
      name: 'mcp_project_operations_idempotency_idx',
      unique: true,
      fields: ['actor_user_id', 'client_id', 'tool_name', 'idempotency_key']
    },
    {
      name: 'mcp_project_operations_project_audit_idx',
      fields: ['project_id', 'id']
    }
  ]
})
export class McpProjectOperation extends Model<McpProjectOperation> {
  @Column({
    type: DataType.BIGINT,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'actor_user_id' })
  actorUserId: number;

  @Column({ type: DataType.STRING(128), allowNull: false, field: 'client_id' })
  clientId: string;

  @Column({ type: DataType.STRING(64), allowNull: false, field: 'tool_name' })
  toolName: string;

  @Column({
    type: DataType.STRING(128),
    allowNull: false,
    field: 'idempotency_key'
  })
  idempotencyKey: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    field: 'request_hash'
  })
  requestHash: string;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: McpProjectOperationStatus.Pending
  })
  status: McpProjectOperationStatus;

  @ForeignKey(() => Project)
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'project_id' })
  projectId: number | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  result: unknown;

  @Column({ type: DataType.JSONB, allowNull: true })
  error: { status?: number; message: string } | null;
}
