'use strict';

module.exports = {
  /** @returns {Promise<void>} Восстанавливает пустые списки и защищает записи в обход модели. */
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        UPDATE tasks task SET controller_ids = ARRAY[project.created_by_id]
        FROM board_columns col
        JOIN boards board ON board.id = col.board_id
        JOIN projects project ON project.id = board.project_id
        WHERE task.column_id = col.id
          AND (task.controller_ids IS NULL OR cardinality(task.controller_ids) = 0);

        CREATE OR REPLACE FUNCTION restore_missing_task_controllers()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE project_owner_id integer;
        BEGIN
          IF NEW.controller_ids IS NULL OR cardinality(NEW.controller_ids) = 0 THEN
            SELECT project.created_by_id INTO project_owner_id
            FROM board_columns col
            JOIN boards board ON board.id = col.board_id
            JOIN projects project ON project.id = board.project_id
            WHERE col.id = NEW.column_id;
            IF project_owner_id IS NULL THEN
              RAISE EXCEPTION 'Project owner is required to restore task controllers';
            END IF;
            NEW.controller_ids := ARRAY[project_owner_id];
          END IF;
          RETURN NEW;
        END;
        $$;

        DROP TRIGGER IF EXISTS tasks_restore_missing_controllers ON tasks;
        CREATE TRIGGER tasks_restore_missing_controllers
          BEFORE INSERT OR UPDATE ON tasks
          FOR EACH ROW EXECUTE FUNCTION restore_missing_task_controllers();

        ALTER TABLE tasks ALTER COLUMN controller_ids SET NOT NULL;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_controllers_nonempty') THEN
            ALTER TABLE tasks ADD CONSTRAINT tasks_controllers_nonempty CHECK (cardinality(controller_ids) > 0 AND array_position(controller_ids, NULL) IS NULL AND 0 < ALL(controller_ids));
          END IF;
        END $$;
      `,
        { transaction }
      );
    });
  },

  /** @returns {Promise<void>} Оставляет восстановленные назначения и прежнюю проверку непустого списка. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS tasks_restore_missing_controllers ON tasks;
        DROP FUNCTION IF EXISTS restore_missing_task_controllers();
      `,
        { transaction }
      );
    });
  }
};
