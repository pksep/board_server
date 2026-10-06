'use strict';

module.exports = {
  /** @returns {Promise<void>} */
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('board_columns', 'status', {
      type: Sequelize.STRING(32),
      allowNull: true,
      defaultValue: null
    });
  },

  /** @returns {Promise<void>} */
  async down(queryInterface) {
    await queryInterface.removeColumn('board_columns', 'status');
  }
};
