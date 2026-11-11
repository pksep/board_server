'use strict';

module.exports = {
  /** @returns {Promise<void>} Сохраняет исходные ID для отката и объединяет типы колонок. */
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS task_column_status_merge_backup (
          column_id INTEGER PRIMARY KEY,
          status VARCHAR(32) NOT NULL
        );
        INSERT INTO task_column_status_merge_backup (column_id, status)
        SELECT id, status FROM board_columns WHERE status = 'in_review'
        ON CONFLICT (column_id) DO NOTHING;
        UPDATE board_columns SET status = 'completed' WHERE status = 'in_review';
      `,
        { transaction }
      );
    });
  },

  /** @returns {Promise<void>} Восстанавливает прежний тип только у сохранённых колонок. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        UPDATE board_columns col SET status = backup.status
        FROM task_column_status_merge_backup backup
        WHERE col.id = backup.column_id AND col.status = 'completed';
        DROP TABLE task_column_status_merge_backup;
      `,
        { transaction }
      );
    });
  }
};
