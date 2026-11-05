'use strict';

module.exports = {
  /** @returns {Promise<void>} Добавляет необязательную норму и пустой список ответственных. */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      const columns = await queryInterface.describeTable('tasks', {
        transaction
      });

      if (!columns.responsible_ids) {
        await queryInterface.addColumn(
          'tasks',
          'responsible_ids',
          {
            type: Sequelize.ARRAY(Sequelize.INTEGER),
            allowNull: false,
            defaultValue: []
          },
          { transaction }
        );
      }

      if (!columns.time_norm_minutes) {
        await queryInterface.addColumn(
          'tasks',
          'time_norm_minutes',
          {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null
          },
          { transaction }
        );
      }

      await queryInterface.sequelize.query(
        `
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_responsibles_valid') THEN
            ALTER TABLE tasks ADD CONSTRAINT tasks_responsibles_valid CHECK (
              array_position(responsible_ids, NULL) IS NULL AND 0 < ALL(responsible_ids)
            );
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_time_norm_positive') THEN
            ALTER TABLE tasks ADD CONSTRAINT tasks_time_norm_positive CHECK (time_norm_minutes IS NULL OR time_norm_minutes > 0);
          END IF;
        END $$;
      `,
        { transaction }
      );
    });
  },

  /** @returns {Promise<void>} Существующие поля, авторство и время выполнения сохраняются. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.removeColumn('tasks', 'time_norm_minutes', {
        transaction
      });
      await queryInterface.removeColumn('tasks', 'responsible_ids', {
        transaction
      });
    });
  }
};
