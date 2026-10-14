'use strict';

module.exports = {
  /** Добавляет необязательную ссылку, не изменяя существующие задачи. */
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tasks', 'linked_entity', {
      type: Sequelize.JSONB,
      allowNull: true
    });
  },

  /** Откат удаляет только введённую этим изменением ссылку на продукцию. */
  async down(queryInterface) {
    await queryInterface.removeColumn('tasks', 'linked_entity');
  }
};
