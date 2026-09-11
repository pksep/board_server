import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  modal,
  titleInput,
  editor,
  status,
  openTask,
  storedTask
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';
const f = await fixture();
const taskPath = `/tasks/${f.task.id}`;
await request(
  taskPath,
  'PUT',
  {
    title: 'Autosave regression',
    description: '<p>Original description</p>',
    priority: '',
    assigneeIds: []
  },
  f.tokens[0]
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const errors = [],
  report = [];
let pages = [];
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
try {
  pages = await Promise.all([0, 1].map(i => newPage(browser, f, i, errors)));
  const [a, b] = pages;
  await Promise.all(pages.map(p => openTask(p, f.task.id)));
  assert.equal(await a.getByTestId(`${modal}-SaveBtn`).count(), 0);
  await titleInput(a).fill('Title saved after pause');
  await until(
    async () =>
      (await request(taskPath, 'GET', undefined, f.tokens[0])).title ===
      'Title saved after pause',
    'Title autosave did not reach server'
  );
  await until(
    async () =>
      (await titleInput(b).inputValue()) === 'Title saved after pause',
    'Other open modal did not receive title'
  );
  pass('title autosaves after pause and reaches second open modal');
  await editor(a).fill('Description from first user');
  await until(
    async () =>
      (
        await request(taskPath, 'GET', undefined, f.tokens[0])
      ).description.includes('Description from first user'),
    'Description not saved'
  );
  await until(
    async () =>
      (await editor(b).innerText()).includes('Description from first user'),
    'Other editor stale'
  );
  pass('description updates in both editors');
  const before = await request(taskPath, 'GET', undefined, f.tokens[0]);
  const assigned = await request(
    taskPath,
    'PUT',
    { assigneeIds: [f.users[1].id] },
    f.tokens[0]
  );
  assert.ok(
    Date.parse(assigned.updatedAt) > Date.parse(before.updatedAt),
    'Assignee-only update must advance snapshot version'
  );
  await until(
    async () =>
      (await storedTask(b, f.task.id)).assigneeIds.includes(
        String(f.users[1].id)
      ),
    'Assignee not synchronized'
  );
  pass('assignee-only change advances version and reaches other user');
  let release;
  const gate = new Promise(r => (release = r));
  let held = false;
  const routeHandler = async route => {
    if (route.request().method() === 'PUT' && !held) {
      held = true;
      await gate;
    }
    await route.continue();
  };
  await a.route(`**/board-api/tasks/${f.task.id}`, routeHandler);
  await titleInput(a).fill('Local title concurrent');
  await until(() => held, 'Autosave did not start');
  await editor(b).fill('Remote description concurrent');
  await until(
    async () =>
      (
        await request(taskPath, 'GET', undefined, f.tokens[0])
      ).description.includes('Remote description concurrent'),
    'Second edit failed'
  );
  release();
  await until(async () => {
    const t = await request(taskPath, 'GET', undefined, f.tokens[0]);
    return (
      t.title === 'Local title concurrent' &&
      t.description.includes('Remote description concurrent')
    );
  }, 'Concurrent fields overwrite each other');
  await until(
    async () =>
      (await editor(a).innerText()).includes('Remote description concurrent'),
    'First modal lost remote description'
  );
  await a.unroute(`**/board-api/tasks/${f.task.id}`, routeHandler);
  pass('concurrent edits to different fields survive');
  let releaseResponse;
  const responseGate = new Promise(r => (releaseResponse = r));
  let responseHeld = false;
  const slowResponse = async route => {
    if (route.request().method() !== 'PUT' || responseHeld) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    responseHeld = true;
    await responseGate;
    await route.fulfill({ response });
  };
  await a.route(`**/board-api/tasks/${f.task.id}`, slowResponse);
  await titleInput(a).fill('First portion');
  await until(() => responseHeld, 'Request response was not delayed');
  await titleInput(a).fill('Second portion must survive');
  const closing = a.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(
    await a.getByTestId(`${modal}-TitleInput`).isVisible(),
    true,
    'Modal closed before save completed'
  );
  releaseResponse();
  await closing;
  await a
    .getByTestId(`${modal}-TitleInput`)
    .waitFor({ state: 'hidden', timeout: 15000 });
  assert.equal(
    (await request(taskPath, 'GET', undefined, f.tokens[0])).title,
    'Second portion must survive'
  );
  await a.unroute(`**/board-api/tasks/${f.task.id}`, slowResponse);
  pass('close waits for pending save and captures typing during request');
  await openTask(a, f.task.id);
  let failures = 0;
  const failSave = async route => {
    if (route.request().method() === 'PUT') {
      failures++;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Test connection interruption' })
      });
    } else await route.continue();
  };
  await a.route(`**/board-api/tasks/${f.task.id}`, failSave);
  await titleInput(a).fill('Retained after error');
  await until(
    async () => (await status(a).getAttribute('data-save-state')) === 'error',
    'No error status'
  );
  await a.keyboard.press('Escape');
  await until(() => failures >= 2, 'Close did not retry save');
  assert.equal(await a.getByTestId(`${modal}-TitleInput`).isVisible(), true);
  assert.equal(await titleInput(a).inputValue(), 'Retained after error');
  assert.equal(await a.getByTestId(`${modal}-AutosaveStatus`).count(), 0);
  assert.equal(
    await a
      .locator('dialog[open]')
      .getByRole('button', { name: 'Повторить', exact: true })
      .count(),
    0
  );
  await a.unroute(`**/board-api/tasks/${f.task.id}`, failSave);
  await a.keyboard.press('Escape');
  await titleInput(a).waitFor({ state: 'hidden', timeout: 15000 });
  assert.equal(
    (await request(taskPath, 'GET', undefined, f.tokens[0])).title,
    'Retained after error'
  );
  pass(
    'save error retains modal and text; closing retries without added controls'
  );
  await b.context().setOffline(true);
  await b.evaluate(() => window.__testSockets.forEach(s => s.close()));
  await request(
    taskPath,
    'PUT',
    { title: 'Changed while disconnected' },
    f.tokens[0]
  );
  await b.context().setOffline(false);
  await until(
    async () =>
      (await titleInput(b).inputValue()) === 'Changed while disconnected',
    'Reconnect failed to refresh'
  );
  pass('reconnection refreshes open modal without browser reload');
  assert.deepEqual(errors, []);
  await a.screenshot({ path: `${artifactDir}/autosave-verified.png` });
} catch (error) {
  console.error(error);
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({
      path: `${artifactDir}/autosave-failure-${i}.png`
    });
    console.log(
      `PAGE ${i}: ${(await pages[i].locator('body').innerText()).slice(-1600)}`
    );
  }
  process.exitCode = 1;
} finally {
  writeFileSync(
    `${artifactDir}/autosave-report.json`,
    JSON.stringify({ report, errors }, null, 2)
  );
  await browser.close();
}
