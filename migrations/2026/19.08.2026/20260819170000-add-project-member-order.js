'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
          DO $migration$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'project_members'
                AND column_name = 'order'
            ) THEN
              ALTER TABLE project_members
              ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

              WITH ranked_members AS (
                SELECT
                  project_members.id,
                  ROW_NUMBER() OVER (
                    PARTITION BY project_members.user_id
                    ORDER BY projects."createdAt" DESC, projects.id DESC
                  ) - 1 AS position
                FROM project_members
                INNER JOIN projects ON projects.id = project_members.project_id
                WHERE projects."deletedAt" IS NULL
              )
              UPDATE project_members
              SET "order" = ranked_members.position
              FROM ranked_members
              WHERE project_members.id = ranked_members.id;
            END IF;
          END
          $migration$
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE INDEX IF NOT EXISTS project_members_user_order_idx
          ON project_members (user_id, "order")
        `,
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
      await queryInterface.sequelize.query(
        'DROP INDEX IF EXISTS project_members_user_order_idx',
        { transaction }
      );
      await queryInterface.sequelize.query(
        'ALTER TABLE project_members DROP COLUMN IF EXISTS "order"',
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
