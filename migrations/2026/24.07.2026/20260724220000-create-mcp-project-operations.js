'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
          CREATE TABLE IF NOT EXISTS mcp_project_operations (
            id BIGSERIAL PRIMARY KEY,
            actor_user_id INTEGER NOT NULL
              REFERENCES users(id)
              ON UPDATE CASCADE
              ON DELETE RESTRICT,
            client_id VARCHAR(128) NOT NULL,
            tool_name VARCHAR(64) NOT NULL,
            idempotency_key VARCHAR(128) NOT NULL,
            request_hash VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            project_id INTEGER
              REFERENCES projects(id)
              ON UPDATE CASCADE
              ON DELETE SET NULL,
            result JSONB,
            error JSONB,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT mcp_project_operations_status_check
              CHECK (status IN ('pending', 'completed', 'failed'))
          )
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE UNIQUE INDEX IF NOT EXISTS
            mcp_project_operations_idempotency_idx
          ON mcp_project_operations (
            actor_user_id,
            client_id,
            tool_name,
            idempotency_key
          )
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE INDEX IF NOT EXISTS
            mcp_project_operations_project_audit_idx
          ON mcp_project_operations (project_id, id)
        `,
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mcp_project_operations');
  }
};
