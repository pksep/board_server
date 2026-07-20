'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const records = await queryInterface.sequelize.query(
      'SELECT COUNT(*) as count FROM users',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    if (records[0].count == '0') {
      const dateNow = new Date();

      await queryInterface.bulkInsert(
        'users',
        [
          {
            login: 'Admin.A.A',
            service_number: '001',
            role: 'admin',
            initial: 'Admin Admin Admin',
            createdAt: dateNow,
            updatedAt: dateNow
          }
        ],
        {}
      );
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('users', null, {});
  }
};
