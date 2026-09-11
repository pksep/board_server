import { existsSync, renameSync } from 'node:fs';
import { artifactDir, fixture, request } from './test-support.mjs';

// Only the project and users created by this suite are eligible for cleanup.
if (!existsSync(`${artifactDir}/regression-fixture.json`)) process.exit(0);
const f = await fixture();
if (
  !f.project.title.startsWith('ERP469 regression ') ||
  !f.users.every(user => user.serviceNumber?.startsWith('ERP469-'))
)
  throw new Error('Fixture ownership cannot be verified.');
await request(`/projects/${f.project.id}`, 'DELETE', undefined, f.tokens[0]);
for (const user of [...f.users].reverse())
  await request('/users/ban', 'POST', { userId: user.id }, f.tokens[0]);
for (const name of ['regression-fixture.json', 'pagination-fixture.json']) {
  const file = `${artifactDir}/${name}`;
  if (existsSync(file)) renameSync(file, `${file}.archived-${Date.now()}`);
}
console.log(
  'ERP469 test project removed; test users archived; reports retained.'
);
