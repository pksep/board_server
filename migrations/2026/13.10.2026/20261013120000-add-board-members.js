'use strict';

module.exports = {
  /** Сохраняет старые доски: null наследует состав проекта, [] означает явную очистку. */
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('boards');
    if (columns.members_ids) return;

    await queryInterface.addColumn('boards', 'members_ids', {
      type: Sequelize.JSONB,
      allowNull: true
    });
  },

  /** Удаляет только поле состава доски при явно запрошенном откате этой миграции. */
  async down(queryInterface) {
    const columns = await queryInterface.describeTable('boards');
    if (!columns.members_ids) return;

    await queryInterface.removeColumn('boards', 'members_ids');
  }
};
