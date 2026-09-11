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
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [];
let page, createdTaskId, createdSubtaskId;
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
try {
  const task = await request(
    `/tasks/${f.task.id}`,
    'PUT',
    {
      title: 'Fresh server title',
      description: '<p>Fresh server description</p>',
      priority: '',
      assigneeIds: []
    },
    f.tokens[0]
  );
  page = await newPage(browser, f, 0, errors);
  await page.evaluate(
    task =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('task-board-drafts', 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('drafts'))
            r.result.createObjectStore('drafts', { keyPath: 'key' });
        };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put({
            key: `task-board:draft:task:${task.id}`,
            title: 'OLD cached title',
            description: '<p>OLD cached description</p>',
            assigneeIds: [],
            tags: [],
            dueDate: null,
            approvalStatus: '',
            priority: '',
            taskNumber: task.taskNumber,
            updatedAt: '2020-01-01T00:00:00Z'
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    task
  );
  await openTask(page, f.task.id);
  assert.equal(await page.getByTestId(`${modal}-DraftRecovery`).count(), 0);
  assert.equal(await titleInput(page).inputValue(), 'Fresh server title');
  assert.equal(await editor(page).innerText(), 'Fresh server description');
  await new Promise(r => setTimeout(r, 1000));
  assert.equal(
    (await request(`/tasks/${f.task.id}`, 'GET', undefined, f.tokens[0])).title,
    'Fresh server title'
  );
  assert.equal(await page.getByRole('button', { name: /черновик/ }).count(), 0);
  pass(
    'old IndexedDB draft cannot overwrite fresh server text or add recovery controls'
  );
  let puts = 0;
  page.on('request', r => {
    if (
      r.method() === 'PUT' &&
      new URL(r.url()).pathname.endsWith(`/tasks/${f.task.id}`)
    )
      puts++;
  });
  await titleInput(page).dispatchEvent('compositionstart');
  const before = puts;
  await titleInput(page).fill('Composed word');
  await new Promise(r => setTimeout(r, 900));
  assert.equal(puts, before, 'Unfinished composition was sent');
  await titleInput(page).dispatchEvent('compositionend');
  await until(
    async () =>
      (await request(`/tasks/${f.task.id}`, 'GET', undefined, f.tokens[0]))
        .title === 'Composed word',
    'Composition completion not saved'
  );
  pass('text composition is saved after the word is completed');
  const beforeBlur = puts;
  await titleInput(page).fill('Saved on field blur');
  await editor(page).click();
  await until(() => puts > beforeBlur, 'Blur did not flush', 550);
  await until(
    async () =>
      (await status(page).getAttribute('data-save-state')) === 'saved',
    'Blur save not completed'
  );
  pass('leaving text field flushes the pending text');
  await page.keyboard.press('Escape');
  await page.getByTestId(`${modal}-TitleInput`).waitFor({ state: 'hidden' });
  const url = `**/board-api/tasks/${f.task.id}`;
  let releaseFirst,
    releaseSecond,
    firstHeld = false,
    secondHeld = false;
  const firstGate = new Promise(r => (releaseFirst = r)),
    secondGate = new Promise(r => (releaseSecond = r));
  const delay = async route => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    if (!firstHeld) {
      const response = await route.fetch();
      firstHeld = true;
      await firstGate;
      await route.fulfill({ response });
    } else {
      secondHeld = true;
      await secondGate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"second selection failed"}'
      });
    }
  };
  await page.route(url, delay);
  await page.evaluate(id => {
    const s = document
      .querySelector('[data-testid="ProjectPage"]')
      .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
        'task_board'
      );
    window.__firstUpdate = s.updateTaskFieldOptimistic(id, 'priority', 'low');
  }, f.task.id);
  await until(() => firstHeld, 'First selection was not held');
  await page.evaluate(id => {
    const s = document
      .querySelector('[data-testid="ProjectPage"]')
      .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
        'task_board'
      );
    window.__secondUpdate = s.updateTaskFieldOptimistic(
      id,
      'priority',
      'urgent'
    );
  }, f.task.id);
  releaseFirst();
  await until(() => secondHeld, 'Second selection was not queued');
  assert.equal(
    (await storedTask(page, f.task.id)).priority,
    'urgent',
    'Older HTTP overwrote newer optimistic selection'
  );
  releaseSecond();
  const results = await page.evaluate(() =>
    Promise.all([window.__firstUpdate, window.__secondUpdate])
  );
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(
    (await storedTask(page, f.task.id)).priority,
    'low',
    'Failure restored outdated local snapshot'
  );
  await page.unroute(url, delay);
  pass(
    'rapid choices stay ordered; failure rolls back to the last confirmed choice'
  );
  // A delayed successful HTTP snapshot must not undo a newer WebSocket snapshot.
  let releaseOld,
    heldOld = false;
  const oldGate = new Promise(r => (releaseOld = r));
  const oldResponse = async route => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    heldOld = true;
    await oldGate;
    await route.fulfill({ response });
  };
  await page.route(url, oldResponse);
  await page.evaluate(id => {
    const s = document
      .querySelector('[data-testid="ProjectPage"]')
      .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
        'task_board'
      );
    window.__oldUpdate = s.updateTask(id, { priority: 'medium' });
  }, f.task.id);
  await until(() => heldOld, 'Old snapshot was not held');
  await request(
    `/tasks/${f.task.id}`,
    'PUT',
    { priority: 'high' },
    f.tokens[1]
  );
  await until(
    async () => (await storedTask(page, f.task.id)).priority === 'high',
    'Newer websocket not applied'
  );
  releaseOld();
  await page.evaluate(() => window.__oldUpdate);
  assert.equal((await storedTask(page, f.task.id)).priority, 'high');
  await page.unroute(url, oldResponse);
  pass('late HTTP response cannot roll back a newer remote edit');
  const col = page.getByTestId('ProjectPage-Column').filter({
    has: page.locator('.board-column__title', { hasText: 'Edits' })
  });
  let creates = 0;
  page.on('request', r => {
    if (
      r.method() === 'POST' &&
      new URL(r.url()).pathname.endsWith(`/columns/${f.column.id}/tasks`)
    )
      creates++;
  });
  await col.getByTestId('ProjectPage-ColumnAdd').click();
  await page.getByTestId(`${modal}-Bottom`).waitFor({ state: 'visible' });
  assert.equal(
    await page.getByTestId(`${modal}-CancelBtn`).innerText(),
    'Отмена'
  );
  assert.equal(
    await page.getByTestId(`${modal}-SaveBtn`).innerText(),
    'Создать'
  );
  assert.equal(await page.getByTestId(`${modal}-SaveBtn`).isDisabled(), true);
  await titleInput(page).fill('Cancelled ERP469 draft');
  await new Promise(r => setTimeout(r, 850));
  assert.equal(creates, 0, 'New draft was automatically created');
  await page.getByTestId(`${modal}-CancelBtn`).click();
  await titleInput(page).waitFor({ state: 'hidden' });
  assert.equal(creates, 0, 'Cancel created a task');
  pass('new-task Cancel closes the draft without creating a task');

  await col.getByTestId('ProjectPage-ColumnAdd').click();
  await titleInput(page).fill('Created once by ERP469 regression');
  await page.getByTestId(modal).screenshot({
    path: `${artifactDir}/new-task-footer.png`,
    animations: 'disabled'
  });
  await page.getByTestId(`${modal}-SaveBtn`).click();
  await page
    .getByTestId(`${modal}-TitleInput`)
    .waitFor({ state: 'hidden', timeout: 15000 });
  assert.equal(creates, 1);
  const found = await request(
    `/columns/${f.column.id}/tasks?limit=5&search=Created%20once%20by%20ERP469`,
    'GET',
    undefined,
    f.tokens[0]
  );
  assert.equal(found.items.length, 1);
  createdTaskId = found.items[0].id;
  pass('restored Create button creates exactly one task');

  await openTask(page, createdTaskId);
  assert.equal(await page.getByTestId(`${modal}-Bottom`).count(), 0);
  await page.getByTestId(modal).screenshot({
    path: `${artifactDir}/existing-task-no-footer.png`,
    animations: 'disabled'
  });
  await page.getByTestId(`${modal}-AddSubtaskBtn`).click();
  const submodal = 'ProjectPage-SubtaskModal';
  await page.getByTestId(`${submodal}-Bottom`).waitFor({ state: 'visible' });
  assert.equal(
    await page.getByTestId(`${submodal}-CancelBtn`).innerText(),
    'Отмена'
  );
  assert.equal(
    await page.getByTestId(`${submodal}-SaveBtn`).isDisabled(),
    true
  );
  await page
    .getByTestId(`${submodal}-TitleInput`)
    .locator('input')
    .or(page.locator(`input[data-testid="${submodal}-TitleInput"]`))
    .fill('Child created with footer');
  const childResponse = page.waitForResponse(
    r =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname.endsWith(`/tasks/${createdTaskId}/subtasks`)
  );
  await page.getByTestId(`${submodal}-SaveBtn`).click();
  const child = await (await childResponse).json();
  createdSubtaskId = child.id;
  assert.equal(child.parentTaskId, createdTaskId);
  assert.equal(child.title, 'Child created with footer');
  await page.getByTestId(`${submodal}-Bottom`).waitFor({ state: 'hidden' });
  pass('new subtask uses the same footer; existing parent has no footer');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (page) {
    console.log((await page.locator('body').innerText()).slice(-1500));
    await page.screenshot({ path: `${artifactDir}/edge-failure.png` });
  }
  process.exitCode = 1;
} finally {
  if (createdSubtaskId)
    await request(
      `/tasks/${createdSubtaskId}`,
      'DELETE',
      undefined,
      f.tokens[0]
    );
  if (createdTaskId)
    await request(`/tasks/${createdTaskId}`, 'DELETE', undefined, f.tokens[0]);
  writeFileSync(
    `${artifactDir}/edge-report.json`,
    JSON.stringify({ report, errors }, null, 2)
  );
  await browser.close();
}
