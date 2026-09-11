import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  modal,
  openTask,
  storedTask
} from './test-support.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const f = await fixture();
const fixtureFile = `${artifactDir}/pagination-fixture.json`;
let data;
if (existsSync(fixtureFile))
  data = JSON.parse(readFileSync(fixtureFile, 'utf8'));
else {
  const child = await request(
    `/tasks/${f.task.id}/subtasks`,
    'POST',
    { title: 'Child with unloaded parent' },
    f.tokens[0]
  );
  await request(
    `/tasks/${child.id}/move`,
    'PATCH',
    { columnId: f.childColumn.id, order: 0 },
    f.tokens[0]
  );
  const ids = [];
  for (let i = 0; i < 111; i++) {
    const task = await request(
      `/columns/${f.column.id}/tasks`,
      'POST',
      {
        title:
          i === 110
            ? 'Tall first card ' + 'long title '.repeat(21)
            : `Pagination row ${i}`
      },
      f.tokens[0]
    );
    ids.push(task.id);
    if (i % 25 === 0) console.log(`Fixture ${i + 1}/111`);
  }
  data = { child, ids };
  writeFileSync(fixtureFile, JSON.stringify(data));
}
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const errors = [],
  report = [],
  requests = [];
let page;
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
const pageState = async () =>
  page.evaluate(
    id =>
      document
        .querySelector('[data-testid="ProjectPage"]')
        .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
          'task_board'
        ).columnPageStates[id],
    f.column.id
  );
const columnBody = () =>
  page
    .getByTestId('ProjectPage-Column')
    .filter({ has: page.locator('.board-column__title', { hasText: 'Edits' }) })
    .locator('.board-column__body');
try {
  page = await newPage(browser, f, 0, errors, {
    search: '',
    activeFilters: ['subtasks'],
    assigneeIds: [],
    priorities: [],
    tagIds: [],
    showSubtasks: true
  });
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.pathname.includes('/columns/') && url.pathname.endsWith('/tasks'))
      requests.push({
        limit: Number(url.searchParams.get('limit')),
        offset: Number(url.searchParams.get('offset'))
      });
  });
  await page
    .getByText('Child with unloaded parent', { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(
    await storedTask(page, f.task.id),
    undefined,
    'Fixture parent should be outside first page'
  );
  pass('child in a separate column is visible before its parent page loads');
  await until(
    async () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-testid="ProjectPage"]')
            .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
              'task_board'
            ).boards[0].tasksCount === 112
      ),
    'Board root counter includes children'
  );
  for (const zoom of [0.75, 1, 1.25, 1.5]) {
    // CSS zoom reproduces layout scaling and changes the available CSS viewport; browser page scale only magnifies pixels.
    await page.evaluate(
      zoom => (document.documentElement.style.zoom = String(zoom)),
      zoom
    );
    await until(
      async () => {
        const state = await pageState();
        const bounds = await columnBody().evaluate(el => ({
          height: el.clientHeight,
          scroll: el.scrollHeight
        }));
        return (
          !state.isLoading &&
          (!state.hasMore || bounds.scroll > bounds.height + 32)
        );
      },
      `Column remains underfilled at ${zoom * 100}%`
    );
    pass(`column fills without a wheel/zoom trigger at ${zoom * 100}%`);
  }
  await page.evaluate(() => (document.documentElement.style.zoom = '1'));
  await until(
    async () => {
      const state = await pageState();
      if (!state.hasMore && !state.isLoading) return true;
      await columnBody().evaluate(el => {
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event('scroll'));
      });
      return false;
    },
    'Could not load all 112 tasks by scrolling',
    60000
  );
  const before = await pageState();
  assert.equal(before.loaded, 112);
  assert.equal(before.taskIds.length, 112);
  assert.equal(new Set(before.taskIds).size, 112);
  pass('scroll loads 112 unique tasks through all pages');
  await openTask(page, f.task.id);
  await page
    .locator('dialog[open]')
    .getByText('Child with unloaded parent', { exact: true })
    .waitFor({ timeout: 15000 });
  await page.evaluate(async id => {
    const s = document
      .querySelector('[data-testid="ProjectPage"]')
      .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
        'task_board'
      );
    await s.loadColumnTasks(id, 10, { reset: true });
  }, f.childColumn.id);
  assert.ok(
    await storedTask(page, data.child.id),
    'Loading child column erased cached subtask'
  );
  await page
    .locator('dialog[open]')
    .getByText('Child with unloaded parent', { exact: true })
    .waitFor();
  pass('parent modal retains child when child column is fetched');
  await page.keyboard.press('Escape');
  await page.getByTestId(`${modal}-TitleInput`).waitFor({ state: 'hidden' });
  await page.context().setOffline(true);
  await page.evaluate(() => window.__testSockets.forEach(s => s.close()));
  await request(
    `/tasks/${f.task.id}`,
    'PUT',
    { description: '<p>Refresh after 112 loaded rows</p>' },
    f.tokens[0]
  );
  await page.context().setOffline(false);
  await until(
    async () =>
      (await storedTask(page, f.task.id))?.description.includes(
        'Refresh after 112 loaded rows'
      ),
    'Revalidation over 100 rows failed'
  );
  await until(
    async () => !(await pageState()).isLoading,
    'Refresh remains loading'
  );
  assert.ok(
    requests.every(r => r.limit > 0 && r.limit <= 100),
    `Invalid page limit: ${JSON.stringify(requests)}`
  );
  assert.equal((await pageState()).loaded, 112);
  pass('reconnect keeps loaded rows and never sends limit over 100');
  await new Promise(r => setTimeout(r, 3500));
  let failures = 0;
  const failPage = async route => {
    failures++;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"test pagination outage"}'
    });
  };
  await page.route(`**/board-api/columns/${f.column.id}/tasks?*`, failPage);
  await page.evaluate(async id => {
    const s = document
      .querySelector('[data-testid="ProjectPage"]')
      .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
        'task_board'
      );
    await s.loadColumnTasks(id, 10, { reset: true });
  }, f.column.id);
  await page.getByTestId(`ProjectPage-ColumnRetry-${f.column.id}`).waitFor();
  await new Promise(r => setTimeout(r, 3500));
  const settledFailures = failures;
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(
    failures,
    settledFailures,
    `Failed page created retry storm: ${failures}`
  );
  await page.unroute(`**/board-api/columns/${f.column.id}/tasks?*`, failPage);
  await page.getByTestId(`ProjectPage-ColumnRetry-${f.column.id}`).click();
  await until(async () => {
    const s = await pageState();
    return s.loaded > 0 && !s.error && !s.isLoading;
  }, 'Retry does not restore tasks');
  pass('failed page stops automatic retries and explicit retry restores tasks');
  // The long selected project name is clipped in the badge, triggering its tooltip.
  await page.getByTestId('TaskBoardFilters-Project-Badge').hover();
  const hint = page.locator(
    '.tooltip-yui-kit__hint[data-testid="TaskBoardFilters-Project-Tooltip"]'
  );
  await hint.waitFor({ timeout: 5000 });
  const overlay = await hint.evaluate(el => {
    const b = el.getBoundingClientRect();
    return {
      z: getComputedStyle(el).zIndex,
      top: b.top,
      visible:
        document.elementFromPoint(
          b.left + b.width / 2,
          b.top + b.height / 2
        ) === el
    };
  });
  assert.ok(overlay.visible, `Tooltip is obscured: ${JSON.stringify(overlay)}`);
  await page.screenshot({ path: `${artifactDir}/tooltip-verified.png` });
  pass('filter tooltip is above header at its actual overlap point');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (page) {
    console.log(
      JSON.stringify({
        pageState: await pageState().catch(() => null),
        body: (await page.locator('body').innerText()).slice(-1500)
      })
    );
    await page.screenshot({ path: `${artifactDir}/pagination-failure.png` });
  }
  process.exitCode = 1;
} finally {
  writeFileSync(
    `${artifactDir}/pagination-report.json`,
    JSON.stringify({ report, errors, requests }, null, 2)
  );
  await browser.close();
}
