'use strict';

module.exports = {
  /** Проекция персональной даты не меняет общий start_date задачи. */
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      const columns = await queryInterface.describeTable('task_assignees', {
        transaction
      });
      if (!columns.production_start_date)
        await queryInterface.addColumn(
          'task_assignees',
          'production_start_date',
          { type: Sequelize.DATE, allowNull: true },
          { transaction }
        );
      const [tables] = await queryInterface.sequelize.query(
        "SELECT to_regclass('production_queue_versions') AS existing",
        { transaction }
      );
      if (!tables[0].existing)
        await queryInterface.createTable(
          'production_queue_versions',
          {
            resource_id: { type: Sequelize.INTEGER, primaryKey: true },
            version: { type: Sequelize.BIGINT, allowNull: false }
          },
          { transaction }
        );
    });
  },

  /** Удаляет только персональную проекцию, сохраняя исходные сроки и назначения. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const columns = await queryInterface.describeTable('task_assignees', {
        transaction
      });
      if (columns.production_start_date)
        await queryInterface.removeColumn(
          'task_assignees',
          'production_start_date',
          { transaction }
        );
      await queryInterface.dropTable('production_queue_versions', {
        transaction
      });
    });
  }
};
