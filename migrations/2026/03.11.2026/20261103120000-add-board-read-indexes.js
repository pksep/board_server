'use strict';

const indexes = [
  ['boards_project_order_idx', 'boards', 'project_id, "order", "createdAt"'],
  ['board_columns_board_order_idx', 'board_columns', 'board_id, "order"'],
  ['tasks_column_order_idx', 'tasks', 'column_id, "order", id'],
  [
    'tasks_column_parent_order_idx',
    'tasks',
    'column_id, parent_task_id, "order", id'
  ],
  ['tasks_parent_order_idx', 'tasks', 'parent_task_id, "order", id'],
  ['task_assignees_task_user_idx', 'task_assignees', 'task_id, user_id'],
  ['task_tags_task_tag_idx', 'task_tags', 'task_id, project_tag_id'],
  ['task_attachments_task_idx', 'task_attachments', 'task_id']
];

/** A cancelled concurrent build may leave an unusable index with the same name. */
async function dropInvalidIndex(queryInterface, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT i.indisvalid FROM pg_catalog.pg_index i
     JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
     WHERE c.oid = to_regclass(:indexName)`,
    { replacements: { indexName: `public.${name}` } }
  );

  if (rows[0]?.indisvalid === false) {
    await queryInterface.sequelize.query(
      `DROP INDEX CONCURRENTLY "public"."${name}"`
    );
  }
}

// CONCURRENTLY must run outside a transaction and keeps normal writes available.
module.exports = {
  async up(queryInterface) {
    for (const [name, table, columns] of indexes) {
      await dropInvalidIndex(queryInterface, name);
      await queryInterface.sequelize.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}"
         ON "public"."${table}" (${columns})`
      );
    }
  },

  async down(queryInterface) {
    for (const [name] of [...indexes].reverse()) {
      await queryInterface.sequelize.query(
        `DROP INDEX CONCURRENTLY IF EXISTS "public"."${name}"`
      );
    }
  }
};
