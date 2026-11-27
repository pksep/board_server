'use strict';

module.exports = {
  /** Отделяет явное редактирование даты от автоматической проекции ERP. */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        'LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE',
        { transaction }
      );
      const columns = await queryInterface.describeTable('tasks', {
        transaction
      });
      if (!columns.start_date_revision) {
        await queryInterface.addColumn(
          'tasks',
          'start_date_revision',
          {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
          },
          { transaction }
        );
      }
      const [tables] = await queryInterface.sequelize.query(
        "SELECT to_regclass('activity_events') AS existing",
        { transaction }
      );
      if (tables[0].existing) {
        // Восстанавливаем уже сохранённые ручные правки, но не даты создания задач.
        await queryInterface.sequelize.query(
          `
          UPDATE tasks task SET start_date_revision = source.revision
          FROM (
            SELECT entity_id, MAX(id) AS revision FROM activity_events
            WHERE entity_type = 'task' AND action_type = 'updated'
              AND changes @> '[{"field":"startDate"}]'::jsonb
            GROUP BY entity_id
          ) source
          WHERE source.entity_id = task.id::text AND task.start_date_revision = 0
        `,
          { transaction }
        );
      }
    });
  },

  /** Убирает только версию синхронизации, сохраняя даты и историю. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        'LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE',
        { transaction }
      );
      const columns = await queryInterface.describeTable('tasks', {
        transaction
      });
      if (columns.start_date_revision) {
        await queryInterface.removeColumn('tasks', 'start_date_revision', {
          transaction
        });
      }
    });
  }
};
