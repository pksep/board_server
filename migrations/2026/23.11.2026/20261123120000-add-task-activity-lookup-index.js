'use strict';

const indexName = 'activity_events_task_lookup_idx';

// CONCURRENTLY runs outside a transaction, as in the existing Board read indexes.
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT i.indisvalid FROM pg_catalog.pg_index i
       WHERE i.indexrelid = to_regclass(:indexName)`,
      { replacements: { indexName: `public.${indexName}` } }
    );

    // An interrupted concurrent build leaves an index that IF NOT EXISTS skips.
    if (rows[0]?.indisvalid === false) {
      await queryInterface.sequelize.query(
        `DROP INDEX CONCURRENTLY "public"."${indexName}"`
      );
    }

    // Match the existing integer join, including legacy numeric strings like 001.
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"
       ON "public"."activity_events" ((entity_id::integer), id)
       WHERE entity_type = 'task'`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "public"."${indexName}"`
    );
  }
};
