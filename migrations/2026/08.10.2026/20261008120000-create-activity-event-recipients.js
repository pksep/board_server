'use strict';

// Исторические назначения не выводятся из сегодняшних исполнителей: backfill намеренно отсутствует.
module.exports = {
  /** Создаёт только указатели на существующий журнал, без копирования событий. */
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS activity_event_recipients (
          event_id INTEGER NOT NULL REFERENCES activity_events(id) ON UPDATE CASCADE ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
          read_at TIMESTAMPTZ,
          PRIMARY KEY (event_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS activity_recipients_feed_idx
          ON activity_event_recipients (user_id, event_id);
        CREATE INDEX IF NOT EXISTS activity_recipients_unread_idx
          ON activity_event_recipients (user_id, event_id) WHERE read_at IS NULL;
      `,
        { transaction }
      );
    });
  },

  /** Удаляет персональные отметки; каноническая история остаётся нетронутой. */
  async down(queryInterface) {
    await queryInterface.dropTable('activity_event_recipients');
  }
};
