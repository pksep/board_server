import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  modal,
  titleInput
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';

const f = await fixture();
const task = await request(
  `/columns/${f.column.id}/tasks`,
  'POST',
  {
    title: 'ERP469 deferred comments',
    description: '<p>Long description before comments.</p>'.repeat(65)
  },
  f.tokens[0]
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [];
let page, releaseComments;
const pass = message => {
  report.push(message);
  console.log(`PASS ${message}`);
};
try {
  page = await newPage(browser, f, 0, errors);
  let commentRequests = 0;
  const commentsGate = new Promise(resolve => (releaseComments = resolve));
  await page.route(
    `**/api/comments/by-entity/tasks/${task.id}*`,
    async route => {
      commentRequests++;
      await commentsGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [], count: 0 })
      });
    }
  );
  const card = page
    .locator('.task-card-wrapper')
    .filter({ hasText: task.title });
  await card.click();
  await titleInput(page).waitFor();
  await page.waitForTimeout(700);
  assert.equal(
    commentRequests,
    0,
    'Comments below the viewport loaded during opening'
  );
  assert.equal(
    await page
      .locator('dialog[open] .modal-comment__input [contenteditable="true"]')
      .count(),
    0
  );
  assert.equal(await page.getByTestId('Comments-StartWriting').count(), 0);
  assert.equal(await page.getByTestId(`${modal}-AutosaveStatus`).count(), 0);
  assert.equal(
    await page.getByText('Все изменения сохранены', { exact: true }).count(),
    0
  );
  pass(
    'task opens with the original layout; offscreen comments and editor are not loaded'
  );

  await page.keyboard.press('Escape');
  await until(
    async () => !(await titleInput(page).isVisible()),
    'Task did not close'
  );
  await page.waitForTimeout(500);
  assert.equal(
    commentRequests,
    0,
    'Closed task started its deferred comments request'
  );
  pass('closing before scrolling to comments cancels deferred loading');

  await card.click();
  await titleInput(page).waitFor();
  await page.locator('dialog[open] .task-comments').scrollIntoViewIfNeeded();
  await until(
    () => commentRequests === 1,
    'Visible comments were not requested automatically'
  );
  const composer = page.locator(
    'dialog[open] .modal-comment__input [contenteditable="true"]'
  );
  await composer.waitFor();
  assert.ok(
    !(await composer.evaluate(el => el === document.activeElement)),
    'Automatically mounted editor stole focus'
  );
  assert.equal(await page.getByTestId('Comments-StartWriting').count(), 0);
  await composer.fill('Text in the original comment editor');
  assert.equal(
    await composer.innerText(),
    'Text in the original comment editor'
  );
  pass(
    'scrolling loads the original editable comment form automatically without a new button or focus change'
  );

  await titleInput(page).fill('Task edit while comments response is pending');
  await until(
    async () =>
      (await request(`/tasks/${task.id}`, 'GET', undefined, f.tokens[0]))
        .title === 'Task edit while comments response is pending',
    'Comments loading blocked task autosave'
  );
  await page.keyboard.press('Escape');
  await until(
    async () => !(await titleInput(page).isVisible()),
    'Pending comment response blocked closing'
  );
  releaseComments();
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator('dialog[open] .modal-comment__input').count(),
    0
  );
  assert.ok(
    !(await titleInput(page).isVisible()),
    'Late comments response reopened task'
  );
  pass(
    'slow comments do not block task editing, autosave or closing; late response leaves the task closed'
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `${artifactDir}/comments-loading-report.json`,
    JSON.stringify({ report, errors }, null, 2)
  );
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: `${artifactDir}/comments-loading-failure.png` })
      .catch(() => {});
  throw error;
} finally {
  releaseComments?.();
  await browser.close();
  await request(`/tasks/${task.id}`, 'DELETE', undefined, f.tokens[0]);
}
