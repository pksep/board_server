/** Настройка сохраняется в проекте; существующие производственные выборки не меняются. */
module.exports = {
  /** @returns {Promise<void>} */
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('projects');
    if (columns.show_in_production) return;

    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn(
        'projects',
        'show_in_production',
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false
        },
        { transaction }
      );
    });
  },

  /** @returns {Promise<void>} */
  async down(queryInterface) {
    const columns = await queryInterface.describeTable('projects');
    if (!columns.show_in_production) return;

    await queryInterface.removeColumn('projects', 'show_in_production');
  }
};
