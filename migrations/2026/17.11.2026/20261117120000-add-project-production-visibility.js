'use strict';

module.exports = {
  /** @returns {Promise<void>} Добавляет сохраняемую настройку видимости проекта на производстве. */
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('projects');
    if (columns.show_in_production) return;

    await queryInterface.addColumn('projects', 'show_in_production', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  /** @returns {Promise<void>} Удаляет только настройку видимости проекта на производстве. */
  async down(queryInterface) {
    const columns = await queryInterface.describeTable('projects');
    if (!columns.show_in_production) return;

    await queryInterface.removeColumn('projects', 'show_in_production');
  }
};
