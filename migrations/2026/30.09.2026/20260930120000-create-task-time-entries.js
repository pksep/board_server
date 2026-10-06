'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
          CREATE TABLE IF NOT EXISTS task_time_entries (
            id SERIAL PRIMARY KEY,
            task_id INTEGER NOT NULL
              REFERENCES tasks(id)
              ON UPDATE CASCADE
              ON DELETE CASCADE,
            user_id INTEGER NOT NULL
              REFERENCES users(id)
              ON UPDATE CASCADE
              ON DELETE RESTRICT,
            duration_minutes INTEGER NOT NULL
              CHECK (duration_minutes > 0),
            comment TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE INDEX IF NOT EXISTS task_time_entries_task_history_idx
          ON task_time_entries (task_id, id DESC)
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
      await queryInterface.dropTable('task_time_entries', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
