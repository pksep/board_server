'use strict';

const lookup = require('../23.11.2026/20261123120000-add-task-activity-lookup-index');

// Revisit installations that already recorded the original unsafe index migration.
module.exports = {
  async up(queryInterface) {
    await lookup.up(queryInterface);
  },

  // The original migration still owns the index; rolling back this replay keeps
  // its repaired definition rather than restoring a cast that rejects old data.
  async down() {
    // Keep the original migration's repaired index and live-read dependency.
  }
};
