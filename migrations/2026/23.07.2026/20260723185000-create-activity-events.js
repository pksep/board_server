'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
          CREATE TABLE IF NOT EXISTS activity_events (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL
              REFERENCES projects(id)
              ON UPDATE CASCADE
              ON DELETE CASCADE,
            entity_type VARCHAR(32) NOT NULL,
            entity_id VARCHAR(64) NOT NULL,
            action_type VARCHAR(32) NOT NULL,
            actor_user_id INTEGER
              REFERENCES users(id)
              ON UPDATE CASCADE
              ON DELETE SET NULL,
            changes JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE INDEX IF NOT EXISTS activity_events_entity_history_idx
          ON activity_events (project_id, entity_type, entity_id, id)
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE INDEX IF NOT EXISTS activity_events_project_history_idx
          ON activity_events (project_id, id)
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
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('activity_events', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
