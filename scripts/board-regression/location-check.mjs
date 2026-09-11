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
  titleInput,
  editor
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';
const f = await fixture();
const report = [],
  errors = [];
const task = await request(
  `/columns/${f.column.id}/tasks`,
  'POST',
  { title: 'Location autosave test' },
  f.tokens[0]
);
const board = await request(
  `/projects/${f.project.id}/boards`,
  'POST',
  { title: `ERP469 destination board ${Date.now()}` },
  f.tokens[0]
);
const column = await request(
  `/boards/${board.id}/columns`,
  'POST',
  { title: 'ERP469 destination column' },
  f.tokens[0]
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
let page;
try {
  page = await newPage(browser, f, 0, errors);
  await openTask(page, task.id);
  let releaseColumns,
    held = false;
  const gate = new Promise(resolve => {
    releaseColumns = resolve;
  });
  await page.route(`**/board-api/boards/${board.id}`, async route => {
    held = true;
    await gate;
    await route.continue();
  });
  await page.getByTestId(`${modal}-LocationPicker-Board-Badge`).click();
  await page
    .locator('dialog[open]')
    .getByText(board.title, { exact: true })
    .click();
  await until(() => held, 'New board columns were not requested');
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(
    await page.getByTestId(`${modal}-LocationPicker-Board-Badge`).innerText(),
    board.title
  );
  assert.equal(
    (await request(`/tasks/${task.id}`, 'GET', undefined, f.tokens[0]))
      .columnId,
    f.column.id
  );
  await titleInput(page).fill('Title while choosing destination');
  await until(
    async () =>
      (await request(`/tasks/${task.id}`, 'GET', undefined, f.tokens[0]))
        .title === 'Title while choosing destination',
    'Incomplete destination blocked title autosave'
  );
  await editor(page).fill('Description while choosing destination');
  await titleInput(page).click();
  await until(
    async () =>
      (
        await request(`/tasks/${task.id}`, 'GET', undefined, f.tokens[0])
      ).description.includes('Description while choosing destination'),
    'Incomplete destination blocked description save on blur'
  );
  assert.equal(
    await page.getByTestId(`${modal}-LocationPicker-Board-Badge`).innerText(),
    board.title
  );
  assert.equal(await page.getByTestId(`${modal}-AutosaveStatus`).count(), 0);
  assert.equal(
    await page
      .getByText(
        'Выберите доску и колонку, чтобы завершить изменение расположения',
        { exact: true }
      )
      .count(),
    0
  );
  assert.equal(
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: 'Повторить', exact: true })
      .count(),
    0
  );
  await page.screenshot({ path: `${artifactDir}/location-without-banner.png` });
  report.push(
    'incomplete destination preserves selection and allows title/description autosave without extra UI'
  );
  console.log(`PASS ${report.at(-1)}`);
  releaseColumns();
  await titleInput(page).fill(
    'Last word before closing incomplete destination'
  );
  await page.keyboard.press('Escape');
  await titleInput(page).waitFor({ state: 'hidden', timeout: 15000 });
  const afterClose = await request(
    `/tasks/${task.id}`,
    'GET',
    undefined,
    f.tokens[0]
  );
  assert.equal(afterClose.columnId, f.column.id);
  assert.equal(
    afterClose.title,
    'Last word before closing incomplete destination'
  );
  report.push(
    'closing an incomplete destination saves the last text and keeps the confirmed location'
  );
  console.log(`PASS ${report.at(-1)}`);

  await openTask(page, task.id);
  await until(
    async () =>
      (await page
        .getByTestId(`${modal}-LocationPicker-Board-Badge`)
        .innerText()) === f.board.title,
    'Reopened task did not restore its confirmed board'
  );
  await page.getByTestId(`${modal}-LocationPicker-Board-Badge`).click();
  await page
    .locator('dialog[open]')
    .getByText(board.title, { exact: true })
    .click();
  await page.getByTestId(`${modal}-LocationPicker-Column-Badge`).click();
  await page
    .locator('dialog[open]')
    .getByText('ERP469 destination column', { exact: true })
    .click();
  await until(
    async () =>
      (await request(`/tasks/${task.id}`, 'GET', undefined, f.tokens[0]))
        .columnId === column.id,
    'Completed destination was not saved'
  );
  await page
    .getByTestId(`${modal}-TitleInput`)
    .waitFor({ state: 'hidden', timeout: 15000 });
  assert.deepEqual(errors, []);
  report.push(
    'destination selection survives slow loading; completed move autosaves once'
  );
  console.log(`PASS ${report.at(-1)}`);
} catch (error) {
  console.error(error);
  if (page) {
    console.log((await page.locator('body').innerText()).slice(-1600));
    await page.screenshot({ path: `${artifactDir}/location-failure.png` });
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  await request(`/tasks/${task.id}`, 'DELETE', undefined, f.tokens[0]);
  await request(`/boards/${board.id}`, 'DELETE', undefined, f.tokens[0]);
  writeFileSync(
    `${artifactDir}/location-report.json`,
    JSON.stringify({ report, errors }, null, 2)
  );
}
