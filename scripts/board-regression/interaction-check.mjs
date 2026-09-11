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
  status,
  storedTask
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';
const f = await fixture();
await request(
  `/tasks/${f.task.id}`,
  'PUT',
  { priority: 'medium' },
  f.tokens[0]
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [],
  timings = [];
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
let page;
try {
  page = await newPage(browser, f, 0, errors, {
    search: '',
    activeFilters: ['priority'],
    priorities: ['low', 'medium', 'high', 'urgent'],
    assigneeIds: [],
    tagIds: [],
    showSubtasks: false
  });
  const count = page.getByTestId('TaskBoardFilters-Priority-Filter-Count');
  const summary = page.getByTestId('TaskBoardFilters-Priority-MiniOptions');
  for (const zoom of [1, 0.75, 1.25, 1.5]) {
    await page.evaluate(
      zoom => (document.documentElement.style.zoom = String(zoom)),
      zoom
    );
    await count.hover();
    await page.waitForTimeout(250);
    const hit = await summary.evaluate(el => {
      const r = el.getBoundingClientRect();
      return {
        height: r.height,
        visible: [0.15, 0.5, 0.85].every(part =>
          el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height * part)
          )
        ),
        top: r.top,
        bottom: r.bottom,
        viewport: innerHeight,
        left: r.left,
        visibility: getComputedStyle(el).visibility,
        opacity: getComputedStyle(el.parentElement).opacity,
        inline: el.parentElement.getAttribute('style'),
        hovered: el.parentElement.parentElement.matches(':hover'),
        hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.className
      };
    });
    assert.ok(
      hit.visible &&
        hit.height > 40 &&
        hit.top >= 0 &&
        hit.bottom <= hit.viewport,
      `Count popup is covered/clipped at ${zoom}: ${JSON.stringify(hit)}`
    );
  }
  await page.evaluate(() => (document.documentElement.style.zoom = '1'));
  await count.hover();
  await page.screenshot({ path: `${artifactDir}/count-verified.png` });
  await page.getByTestId('TaskBoardFilters-Priority-MiniOptions-Icon2').click();
  await until(
    async () => (await count.innerText()).trim().startsWith('+2'),
    'Count selection removal failed'
  );
  pass(
    'exact priority Count popup is above headers and outside scroll clipping at 75–150%; selected values remain removable'
  );
  await page.context().close();

  page = await newPage(browser, f, 0, errors, {
    search: '',
    activeFilters: [],
    priorities: [],
    assigneeIds: [],
    tagIds: [],
    showSubtasks: false
  });
  // Keep this task first even when the pagination fixture is already present.
  const task = await storedTask(page, f.task.id);
  if (!task) {
    await until(async () => {
      await page.evaluate(async id => {
        const store = document
          .querySelector('[data-testid="ProjectPage"]')
          .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
            'task_board'
          );
        const state = store.columnPageStates[id];
        if (state.hasMore && !state.isLoading && !state.refreshRequestId)
          await store.loadColumnTasks(id, 100);
      }, f.column.id);
      return !!(await storedTask(page, f.task.id));
    }, 'Target task was not paginated into the test viewport');
  }
  const current = await request(
    `/tasks/${f.task.id}`,
    'GET',
    undefined,
    f.tokens[0]
  );
  const card = page
    .locator('.task-card-wrapper')
    .filter({ hasText: current.title })
    .first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const pending = [];
  let held = true,
    gets = 0;
  await page.route(`**/board-api/tasks/${f.task.id}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    gets++;
    if (held) await new Promise(resolve => pending.push(resolve));
    await route.continue();
  });
  await page.evaluate(() => {
    window.__interactionLongTasks = [];
    new PerformanceObserver(list =>
      window.__interactionLongTasks.push(
        ...list
          .getEntries()
          .map(e => ({ start: e.startTime, duration: e.duration }))
      )
    ).observe({ type: 'longtask', buffered: false });
  });
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.start');
  const box = await card.boundingBox();
  const start = Date.now();
  await page.mouse.click(box.x + 80, box.y + 25);
  await titleInput(page).waitFor({ timeout: 1000 });
  const latency = Date.now() - start;
  assert.ok(latency < 1000, `Cached card took ${latency}ms to open`);
  await page.mouse.click(box.x + 80, box.y + 25, { clickCount: 2 });
  await page.waitForTimeout(150);
  assert.ok(await titleInput(page).isVisible(), 'Repeated clicks closed task');
  assert.equal(
    gets,
    1,
    'Repeated clicks / route query issued duplicate task GETs'
  );
  assert.equal(await page.getByTestId(`${modal}-Bottom`).count(), 0);
  assert.equal(await page.getByTestId(`${modal}-CancelBtn`).count(), 0);
  const { profile } = await profiler.send('Profiler.stop');
  writeFileSync(`${artifactDir}/task-open.cpuprofile`, JSON.stringify(profile));
  pass(
    `card opens before server response (${latency}ms); repeated real clicks keep one window and one lookup; footer absent`
  );
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await until(
    async () => !(await titleInput(page).isVisible()),
    'Close waits for unrelated background task GET'
  );
  held = false;
  pending.splice(0).forEach(resolve => resolve());
  await page.waitForTimeout(900);
  assert.ok(
    !(await titleInput(page).isVisible()),
    'Late GET reopened the closed task'
  );
  assert.equal(new URL(page.url()).searchParams.get('task'), null);
  pass('closing while lookup is pending stays closed after its response');
  await page.unroute(`**/board-api/tasks/${f.task.id}`);

  const lookups = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (
      req.method() === 'GET' &&
      url.pathname === `/board-api/tasks/${f.task.id}`
    )
      lookups.push(url.pathname);
  });
  const reopen = Date.now();
  await card.click();
  await titleInput(page).waitFor({ timeout: 1000 });
  const reopenMs = Date.now() - reopen;
  await page.waitForTimeout(800);
  assert.equal(lookups.length, 1, 'Own route update reloaded task');
  const columnRequests = [];
  page.on('request', req => {
    if (req.method() === 'GET' && /\/columns\/\d+\/tasks\?/.test(req.url()))
      columnRequests.push(req.url());
  });
  const title = `Interaction ${Date.now()}`;
  await titleInput(page).fill(title);
  await until(
    async () =>
      (await request(`/tasks/${f.task.id}`, 'GET', undefined, f.tokens[0]))
        .title === title,
    'Autosave failed'
  );
  await until(
    async () =>
      (await status(page).getAttribute('data-save-state')) === 'saved',
    'Save did not settle'
  );
  await page.waitForTimeout(600);
  assert.equal(
    columnRequests.length,
    0,
    'Ordinary text edit reloaded every column'
  );
  timings.push({
    cachedOpenMs: latency,
    reopenMs,
    longTasks: await page.evaluate(() => window.__interactionLongTasks)
  });
  await page.screenshot({ path: `${artifactDir}/modal-without-footer.png` });
  pass(
    'one fresh lookup per opening; text autosave updates task without reloading board columns'
  );
  assert.equal(await page.getByTestId('Comments-StartWriting').count(), 0);
  assert.equal(
    await page.getByText('Все изменения сохранены', { exact: true }).count(),
    0
  );
  assert.equal(await page.getByTestId(`${modal}-AutosaveStatus`).count(), 0);
  await page.locator('dialog[open] .task-comments').scrollIntoViewIfNeeded();
  const composer = page.locator(
    'dialog[open] .modal-comment__input [contenteditable="true"]'
  );
  await composer.waitFor();
  await composer.fill('Automatically loaded composer draft');
  assert.ok(
    (await composer.innerText()).includes('Automatically loaded composer draft')
  );
  pass(
    'original comment editor loads automatically when visible; no start-writing button or saved-status label'
  );
  await page.keyboard.press('Escape');
  await until(
    async () => !(await titleInput(page).isVisible()),
    'Task did not close'
  );

  const other = await page.evaluate(
    id =>
      document
        .querySelector('[data-testid="ProjectPage"]')
        .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
          'task_board'
        )
        .tasks.find(t => t.id !== id && !t.parentTaskId),
    f.task.id
  );
  if (other) {
    let releaseOld;
    const oldGate = new Promise(resolve => (releaseOld = resolve));
    let oldPending = false;
    await page.route(`**/board-api/tasks/${f.task.id}`, async route => {
      oldPending = true;
      await oldGate;
      await route.continue();
    });
    await page.evaluate(
      id =>
        document
          .querySelector('[data-testid="ProjectPage"]')
          .__vueParentComponent.appContext.config.globalProperties.$router.push(
            { query: { task: String(id) } }
          ),
      f.task.id
    );
    await until(() => oldPending, 'Lookup was not started');
    await page.evaluate(
      id =>
        document
          .querySelector('[data-testid="ProjectPage"]')
          .__vueParentComponent.appContext.config.globalProperties.$router.push(
            { query: { task: String(id) } }
          ),
      other.id
    );
    await until(
      async () => (await titleInput(page).inputValue()) === other.title,
      'New selection did not open'
    );
    releaseOld();
    await page.waitForTimeout(700);
    assert.equal(
      await titleInput(page).inputValue(),
      other.title,
      'Previous lookup replaced the latest selected task'
    );
    assert.equal(
      new URL(page.url()).searchParams.get('task'),
      String(other.id)
    );
    await page.unroute(`**/board-api/tasks/${f.task.id}`);
    await page.keyboard.press('Escape');
    await until(
      async () => !(await titleInput(page).isVisible()),
      'New selection did not close'
    );
    pass(
      'switching to another task wins over a delayed response for the previous task'
    );
  }

  const linkRequests = [];
  await profiler.send('Network.enable');
  profiler.on('Network.requestWillBeSent', data => {
    if (
      new URL(data.request.url).pathname === `/board-api/tasks/${f.task.id}`
    ) {
      const frames = [];
      for (let stack = data.initiator.stack; stack; stack = stack.parent)
        frames.push(...stack.callFrames.map(frame => frame.functionName));
      linkRequests.push(frames);
    }
  });
  await page.goto(
    `${new URL(page.url()).origin}/projects/${f.project.id}?task=${f.task.id}`,
    { waitUntil: 'domcontentloaded' }
  );
  await titleInput(page).waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  assert.equal(
    linkRequests.filter(frames => frames.includes('openTaskFromRoute')).length,
    1,
    'Direct task link repeated its opening lookup'
  );
  assert.ok(
    linkRequests.every(
      frames =>
        frames.includes('openTaskFromRoute') ||
        frames.includes('refreshOpenTasks')
    ),
    'Unexpected direct-link lookup'
  );
  pass(
    'direct task link has one opening lookup; post-subscription synchronization remains enabled'
  );

  assert.deepEqual(errors, []);
  writeFileSync(
    `${artifactDir}/interaction-report.json`,
    JSON.stringify({ report, timings, errors }, null, 2)
  );
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: `${artifactDir}/interaction-failure.png` })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
