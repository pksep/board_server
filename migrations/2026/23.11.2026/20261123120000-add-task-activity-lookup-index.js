'use strict';

const indexName = 'activity_events_task_lookup_idx';

// CONCURRENTLY runs outside a transaction, as in the existing Board read indexes.
module.exports = {
  async up(queryInterface) {
    // Preserve PostgreSQL integer spelling rules; historical non-task IDs cannot
    // resolve to a task and must not abort a concurrent index build.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION public.activity_task_entity_id(value text)
      RETURNS integer LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
      BEGIN
        IF pg_catalog.pg_input_is_valid(value, 'integer') THEN
          RETURN value::integer;
        END IF;
        RETURN NULL;
      END;
      $fn$;
    `);
    const [rows] = await queryInterface.sequelize.query(
      `SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_catalog.pg_index i
       WHERE i.indexrelid = to_regclass(:indexName)`,
      { replacements: { indexName: `public.${indexName}` } }
    );

    // An interrupted concurrent build leaves an index that IF NOT EXISTS skips.
    if (
      rows[0] &&
      (!rows[0].indisvalid ||
        !rows[0].definition.includes('activity_task_entity_id'))
    ) {
      await queryInterface.sequelize.query(
        `DROP INDEX CONCURRENTLY "public"."${indexName}"`
      );
    }

    // Match the existing integer join, including legacy numeric strings like 001.
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"
       ON "public"."activity_events" (public.activity_task_entity_id(entity_id), id)
       WHERE entity_type = 'task'`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "public"."${indexName}"`
    );
    // The safe conversion is also used by the feed, including after index rollback.
    // Keep it so rollback of this performance index cannot break application reads.
  }
};
