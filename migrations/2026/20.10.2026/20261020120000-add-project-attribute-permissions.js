'use strict';

module.exports = {
  /** @returns {Promise<void>} Сохраняет прежние ограничения для существующих проектов. */
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('projects');
    if (columns.attributes_owner_only) return;

    await queryInterface.addColumn('projects', 'attributes_owner_only', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },

  /** @returns {Promise<void>} Удаляет только настройку прав атрибутов. */
  async down(queryInterface) {
    const columns = await queryInterface.describeTable('projects');
    if (!columns.attributes_owner_only) return;

    await queryInterface.removeColumn('projects', 'attributes_owner_only');
  }
};
