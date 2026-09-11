import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';

const f = await fixture();
const token = f.tokens[0];
const original = await request(`/tasks/${f.task.id}`, 'GET', undefined, token);
await request(`/tasks/${f.task.id}`, 'PUT', { priority: 'high' }, token);
const board = await request(
  `/projects/${f.project.id}/boards`,
  'POST',
  { title: `Drag persistence ${Date.now()}` },
  token
);
const column = await request(
  `/boards/${board.id}/columns`,
  'POST',
  { title: 'Drag source' },
  token
);
const target = await request(
  `/boards/${board.id}/columns`,
  'POST',
  { title: 'Drag target' },
  token
);
const rows = [];
for (let index = 5; index >= 0; index--)
  rows[index] = await request(
    `/columns/${column.id}/tasks`,
    'POST',
    {
      title: `Drag row ${index}`,
      priority: [0, 3, 5].includes(index) ? 'high' : 'low'
    },
    token
  );
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [],
  requests = [],
  snapshots = [];
let page;
/** Records a verified persistence scenario. */
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
/** Reads canonical positions independently of the browser's optimistic state. */
const positions = async () =>
  (
    await Promise.all(
      rows.map(row => request(`/tasks/${row.id}`, 'GET', undefined, token))
    )
  ).map(row => ({ id: row.id, columnId: row.columnId, order: row.order }));
/** Gets the displayed task sequence in a real column. */
const titles = id =>
  page.locator(`[data-column-id="${id}"] .task-card__title`).allTextContents();
try {
  for (const mode of ['cards', 'list']) {
    // Restore a known full order, including tasks excluded by the priority filter.
    for (let index = 0; index < rows.length; index++)
      await request(
        `/tasks/${rows[index].id}/move`,
        'PATCH',
        { columnId: column.id, order: index },
        token
      );
    page = await newPage(browser, f, 0, errors, {
      search: '',
      activeFilters: ['priority'],
      priorities: ['high'],
      assigneeIds: [],
      tagIds: [],
      showSubtasks: false
    });
    page.on('request', req => {
      if (/\/tasks\/\d+\/move$/.test(new URL(req.url()).pathname))
        requests.push({ url: req.url(), body: req.postDataJSON() });
    });
    await page
      .getByTestId('ProjectPage-BoardItem')
      .filter({ hasText: board.title })
      .click();
    await page.getByText(rows[0].title, { exact: true }).waitFor();
    await page
      .getByTestId(
        mode === 'list'
          ? 'TaskBoardViewSwitch-List'
          : 'TaskBoardViewSwitch-Cards'
      )
      .click();
    await until(
      async () => (await titles(column.id)).length === 3,
      'Priority filter did not settle'
    );
    const before = await positions();
    const saved = page.waitForResponse(
      res =>
        res.request().method() === 'PATCH' &&
        res.url().endsWith(`/tasks/${rows[0].id}/move`)
    );
    await page
      .getByText(rows[0].title, { exact: true })
      .dragTo(page.getByText(rows[3].title, { exact: true }));
    const response = await saved;
    assert.equal(response.status(), 200);
    const after = await positions();
    snapshots.push({ mode, before, after, requests: [...requests] });
    assert.ok(
      after[0].order > after[3].order && after[0].order < after[5].order,
      'Filtered drag returned to the previous position: move used a visible index instead of full column order'
    );
    await until(
      async () =>
        JSON.stringify(await titles(column.id)) ===
        JSON.stringify([rows[3].title, rows[0].title, rows[5].title]),
      'Browser did not retain filtered reorder'
    );
    await page.reload();
    await page
      .getByTestId('ProjectPage-BoardItem')
      .filter({ hasText: board.title })
      .click();
    await page.getByText(rows[0].title, { exact: true }).waitFor();
    await until(
      async () =>
        JSON.stringify(await titles(column.id)) ===
        JSON.stringify([rows[3].title, rows[0].title, rows[5].title]),
      'Reload lost the saved order'
    );
    pass(
      `${mode}: filtered reordering persists relative to hidden tasks and survives reload`
    );
    await page.context().close();
  }
  page = await newPage(browser, f, 0, errors);
  let blockedMoves = 0;
  await page.routeWebSocket(/socket\.io/, ws => {
    const server = ws.connectToServer();
    server.onMessage(message => {
      if (String(message).includes('task:moved')) blockedMoves++;
      else ws.send(message);
    });
  });
  await page.reload();
  await page
    .getByTestId('ProjectPage-BoardItem')
    .filter({ hasText: board.title })
    .click();
  await page.getByText(rows[0].title, { exact: true }).waitFor();
  await page.getByTestId('TaskBoardViewSwitch-List').click();
  const other = await newPage(browser, f, 1, errors);
  await other
    .getByTestId('ProjectPage-BoardItem')
    .filter({ hasText: board.title })
    .click();
  await other.getByText(rows[0].title, { exact: true }).waitFor();
  const saved = page.waitForResponse(
    res =>
      res.request().method() === 'PATCH' &&
      res.url().endsWith(`/tasks/${rows[0].id}/move`)
  );
  const targetGroup = page
    .getByTestId('ProjectPage-Column')
    .filter({ has: page.locator(`[data-column-id="${target.id}"]`) });
  await page
    .getByText(rows[0].title, { exact: true })
    .dragTo(targetGroup.locator('.board-column__header'));
  assert.equal((await saved).status(), 200);
  assert.equal(
    (await request(`/tasks/${rows[0].id}`, 'GET', undefined, token)).columnId,
    target.id
  );
  await until(async () => blockedMoves > 0, 'Did not intercept the move event');
  await until(
    async () => (await titles(target.id)).includes(rows[0].title),
    'A successful HTTP move disappeared without its WebSocket echo',
    3000
  );
  await until(
    async () =>
      (
        await other
          .locator(`[data-column-id="${target.id}"] .task-card__title`)
          .allTextContents()
      ).includes(rows[0].title),
    'Move did not reach the other user'
  );
  pass(
    'moving between columns retains the task without its realtime echo and reaches the other user'
  );
  await page.route(`**/tasks/${rows[0].id}/move`, async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Test move rejected' })
    });
  });
  const rejected = page.waitForResponse(
    res =>
      res.request().method() === 'PATCH' &&
      res.url().endsWith(`/tasks/${rows[0].id}/move`)
  );
  const sourceGroup = page
    .getByTestId('ProjectPage-Column')
    .filter({ has: page.locator(`[data-column-id="${column.id}"]`) });
  await page
    .getByText(rows[0].title, { exact: true })
    .dragTo(sourceGroup.locator('.board-column__header'));
  assert.equal((await rejected).status(), 409);
  await until(
    async () =>
      (await titles(target.id)).includes(rows[0].title) &&
      !(await titles(column.id)).includes(rows[0].title),
    'Rejected move lost the card or left a duplicate'
  );
  assert.equal(
    (await request(`/tasks/${rows[0].id}`, 'GET', undefined, token)).columnId,
    target.id
  );
  pass(
    'a rejected move restores its original column membership without duplicates'
  );
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (page)
    await page.screenshot({
      path: `${artifactDir}/drag-persistence-failure.png`
    });
  process.exitCode = 1;
} finally {
  await browser.close();
  await request(`/boards/${board.id}`, 'DELETE', undefined, token);
  await request(
    `/tasks/${f.task.id}`,
    'PUT',
    { priority: original.priority },
    token
  );
  writeFileSync(
    `${artifactDir}/drag-persistence-report.json`,
    JSON.stringify({ report, errors, requests, snapshots }, null, 2)
  );
}
