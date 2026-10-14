'use strict';

module.exports = {
  /** @returns {Promise<void>} Сохраняет старые данные и прежнее разрешение колонок. */
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('board_columns');
    if (columns.move_permission) return;

    await queryInterface.addColumn('board_columns', 'move_permission', {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: 'any_actions'
    });
  },

  /** @returns {Promise<void>} Откатывает только эту настройку при явном запуске down. */
  async down(queryInterface) {
    const columns = await queryInterface.describeTable('board_columns');
    if (!columns.move_permission) return;

    await queryInterface.removeColumn('board_columns', 'move_permission');
  }
};
