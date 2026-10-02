'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'projects',
        'task_attribute_definitions',
        {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: []
        },
        { transaction }
      );
      await queryInterface.addColumn(
        'tasks',
        'start_date',
        {
          type: Sequelize.DATE,
          allowNull: true
        },
        { transaction }
      );
      await queryInterface.sequelize.query(
        'UPDATE "tasks" SET "start_date" = "createdAt" WHERE "start_date" IS NULL',
        { transaction }
      );
      await queryInterface.changeColumn(
        'tasks',
        'start_date',
        {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        { transaction }
      );
      await queryInterface.addColumn(
        'tasks',
        'custom_attribute_values',
        {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {}
        },
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
      await queryInterface.removeColumn('tasks', 'custom_attribute_values', {
        transaction
      });
      await queryInterface.removeColumn('tasks', 'start_date', { transaction });
      await queryInterface.removeColumn(
        'projects',
        'task_attribute_definitions',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
