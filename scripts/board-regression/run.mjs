import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Sequential checks share only their own isolated fixture and cannot race each other's mutations.
for (const test of [
  'autosave-check',
  'pagination-check',
  'edge-check',
  'location-check',
  'interaction-check',
  'comments-loading-check',
  'list-view-check',
  'calendar-check',
  'field-popovers-check',
  'drag-persistence-check',
  'drag-scroll-check'
]) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(`./${test}.mjs`, import.meta.url))],
    { stdio: 'inherit', env: process.env }
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
