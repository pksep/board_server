'use strict';

module.exports = {
  /** Сохраняет авторство и назначает автора контроллером каждой существующей задачи. */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      const columns = await queryInterface.describeTable('tasks', {
        transaction
      });
      if (!columns.controller_ids)
        await queryInterface.addColumn(
          'tasks',
          'controller_ids',
          {
            type: Sequelize.ARRAY(Sequelize.INTEGER),
            allowNull: true
          },
          { transaction }
        );

      await queryInterface.sequelize.query(
        'UPDATE tasks SET controller_ids = ARRAY[created_by_id] WHERE controller_ids IS NULL',
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE tasks ALTER COLUMN controller_ids SET NOT NULL;
         DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_controllers_nonempty') THEN
             ALTER TABLE tasks ADD CONSTRAINT tasks_controllers_nonempty CHECK (cardinality(controller_ids) > 0 AND array_position(controller_ids, NULL) IS NULL AND 0 < ALL(controller_ids));
           END IF;
         END $$;`,
        { transaction }
      );
    });
  },

  /** Удаляет только список полномочий, не затрагивая автора и историю. */
  async down(queryInterface) {
    await queryInterface.removeColumn('tasks', 'controller_ids');
  }
};
