'use strict';

module.exports = {
  /** @returns {Promise<void>} Добавляет правила задач; старые проекты остаются без новых ограничений. */
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('projects');
    if (columns.task_permissions) return;

    await queryInterface.addColumn('projects', 'task_permissions', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null
    });
  },

  /** @returns {Promise<void>} Удаляет только сохранённые правила задач. */
  async down(queryInterface) {
    const columns = await queryInterface.describeTable('projects');
    if (!columns.task_permissions) return;

    await queryInterface.removeColumn('projects', 'task_permissions');
  }
};
