'use strict';

module.exports = {
  /** Сохраняет старые записи и разрешает время без задачи. @returns {Promise<void>} */
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE task_time_entries ALTER COLUMN task_id DROP NOT NULL;
        ALTER TABLE task_time_entries ADD COLUMN IF NOT EXISTS created_by_id INTEGER
          REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
        UPDATE task_time_entries SET created_by_id = user_id WHERE created_by_id IS NULL;
        ALTER TABLE task_time_entries ALTER COLUMN created_by_id SET NOT NULL;
        CREATE OR REPLACE FUNCTION task_time_entries_default_author() RETURNS trigger AS $$
        BEGIN
          NEW.created_by_id := COALESCE(NEW.created_by_id, NEW.user_id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS task_time_entries_default_author ON task_time_entries;
        CREATE TRIGGER task_time_entries_default_author BEFORE INSERT ON task_time_entries
          FOR EACH ROW EXECUTE FUNCTION task_time_entries_default_author();
        CREATE INDEX IF NOT EXISTS task_time_entries_standalone_history_idx
          ON task_time_entries (id DESC) WHERE task_id IS NULL;
      `,
        { transaction }
      );
    });
  },

  /** Не удаляет самостоятельное время при откате. @returns {Promise<void>} */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        LOCK TABLE task_time_entries IN ACCESS EXCLUSIVE MODE;
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM task_time_entries WHERE task_id IS NULL OR created_by_id <> user_id) THEN
            RAISE EXCEPTION 'Cannot roll back: standalone or delegated time entries exist';
          END IF;
        END $$;
        DROP INDEX IF EXISTS task_time_entries_standalone_history_idx;
        DROP TRIGGER IF EXISTS task_time_entries_default_author ON task_time_entries;
        DROP FUNCTION IF EXISTS task_time_entries_default_author();
        ALTER TABLE task_time_entries DROP COLUMN IF EXISTS created_by_id;
        ALTER TABLE task_time_entries ALTER COLUMN task_id SET NOT NULL;
      `,
        { transaction }
      );
    });
  }
};
