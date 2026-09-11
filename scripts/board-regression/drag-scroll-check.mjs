import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  storedTask,
  modal,
  titleInput
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';

const f = await fixture();
const token = f.tokens[0];
const board = await request(
  `/projects/${f.project.id}/boards`,
  'POST',
  { title: `Drag scroll ${Date.now()}` },
  token
);
const column = await request(
  `/boards/${board.id}/columns`,
  'POST',
  { title: 'Scrollable tasks' },
  token
);
const rows = [];
for (let i = 59; i >= 0; i--)
  rows[i] = await request(
    `/columns/${column.id}/tasks`,
    'POST',
    { title: `Scroll task ${i}` },
    token
  );
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [];
let page, other;
let moves = 0;
/** Records an outcome reached with actual mouse input and canonical persistence. */
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
/** Holds a task without scripted scroll or synthetic drag/drop events. */
const startDrag = async locator => {
  await locator.scrollIntoViewIfNeeded();
  const font = await locator.evaluate(
    el =>
      getComputedStyle(
        el.closest('.task-card').querySelector('.task-card__title')
      ).fontFamily
  );
  const rect = await locator.boundingBox();
  await page.mouse.move(rect.x + 12, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 25, rect.y + rect.height / 2 + 8, {
    steps: 5
  });
  assert.equal(
    await page
      .locator('.task-card[aria-hidden="true"] .task-card__title')
      .evaluate(el => getComputedStyle(el).fontFamily),
    font,
    'Drag preview changed the original typeface'
  );
};
/** Moves over a visible target and releases the task, including its final click event. */
const finishDrag = async locator => {
  const rect = await locator.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, {
    steps: 5
  });
  await page.mouse.up();
};
try {
  page = await newPage(browser, f, 0, errors);
  other = await newPage(browser, f, 1, errors);
  for (const p of [page, other])
    await p
      .getByTestId('ProjectPage-BoardItem')
      .filter({ hasText: board.title })
      .click();
  page.on('request', req => {
    if (
      req.method() === 'PATCH' &&
      req.url().endsWith(`/tasks/${rows[0].id}/move`)
    )
      moves++;
  });
  for (const mode of ['cards', 'list']) {
    for (const p of [page, other])
      await p
        .getByTestId(
          `TaskBoardViewSwitch-${mode === 'list' ? 'List' : 'Cards'}`
        )
        .click();
    const viewport =
      mode === 'list'
        ? page.getByTestId('ProjectPage-Columns')
        : page.locator(`[data-column-id="${column.id}"]`);
    await viewport.evaluate(el => {
      el.scrollTop = 0;
    });
    const card = page.getByText(rows[0].title, { exact: true });
    await startDrag(card);
    const bounds = await viewport.boundingBox();
    const x = bounds.x + bounds.width / 2;
    await page.mouse.move(x, bounds.y + bounds.height / 2, { steps: 5 });
    const before = await viewport.evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, 500);
    await until(
      async () => (await viewport.evaluate(el => el.scrollTop)) > before + 100,
      `${mode}: wheel cannot scroll down while holding a task`
    );
    await page.mouse.wheel(0, -500);
    await until(
      async () => (await viewport.evaluate(el => el.scrollTop)) === 0,
      `${mode}: wheel cannot scroll back up`
    );
    pass(`${mode}: wheel scrolls down and up while the same task remains held`);

    const requestsBefore = moves;
    // Only wheel input reaches tasks outside the initial viewport and causes page loading.
    for (
      let i = 0;
      i < 15 && (await viewport.evaluate(el => el.scrollTop)) < 1400;
      i++
    ) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(150);
    }
    assert.ok(
      (await viewport.evaluate(el => el.scrollTop)) >= 1400,
      `${mode}: wheel did not reach unloaded tasks`
    );
    const targetId = await viewport
      .locator('[data-task-id]')
      .evaluateAll((elements, bounds) => {
        const visible = elements.filter(el => {
          const r = el.getBoundingClientRect();
          return (
            r.top > bounds.y + 60 && r.bottom < bounds.y + bounds.height - 60
          );
        });
        return Number(visible.at(-1)?.dataset.taskId);
      }, bounds);
    assert.ok(targetId && targetId !== rows[0].id);
    const target = await request(`/tasks/${targetId}`, 'GET', undefined, token);
    assert.equal(
      moves,
      requestsBefore,
      'Scrolling sent a move before mouse release'
    );
    await page.screenshot({ path: `${artifactDir}/drag-scroll-${mode}.png` });
    await finishDrag(viewport.locator(`[data-task-id="${targetId}"]`));
    await until(
      async () =>
        (await request(`/tasks/${rows[0].id}`, 'GET', undefined, token))
          .order === target.order,
      `${mode}: offscreen drop did not persist`
    );
    await until(
      async () => (await storedTask(other, rows[0].id))?.order === target.order,
      `${mode}: other user did not receive the new order`
    );
    assert.equal(moves, requestsBefore + 1);
    assert.equal(
      await page.getByTestId(`${modal}-TitleInput`).count(),
      0,
      'Release unexpectedly opened the task'
    );
    assert.equal(
      await page.locator('.task-card[aria-hidden="true"]').count(),
      0,
      'Drag preview was left behind'
    );
    pass(
      `${mode}: wheel reaches offscreen tasks; one drop persists in both sessions without opening a modal`
    );

    await startDrag(card);
    const initialEdgeTop = await viewport.evaluate(el => el.scrollTop);
    await page.mouse.move(x, bounds.y + bounds.height - 20, { steps: 5 });
    await until(
      async () =>
        (await viewport.evaluate(el => el.scrollTop)) > initialEdgeTop + 150,
      `${mode}: bottom edge did not scroll`
    );
    const edgeTop = await viewport.evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, -500);
    await until(
      async () => (await viewport.evaluate(el => el.scrollTop)) < edgeTop - 150,
      `${mode}: edge scrolling overrode manual wheel direction`
    );
    const manualTop = await viewport.evaluate(el => el.scrollTop);
    await page.waitForTimeout(250);
    assert.ok(
      (await viewport.evaluate(el => el.scrollTop)) <= manualTop + 10,
      'Autoscroll pulled the list back after wheel input'
    );
    await page.mouse.move(x, bounds.y + 20, { steps: 5 });
    await until(
      async () => (await viewport.evaluate(el => el.scrollTop)) === 0,
      `${mode}: top edge did not reach the beginning`,
      20000
    );
    await finishDrag(viewport.locator('[data-task-id]').first());
    await until(
      async () =>
        (await request(`/tasks/${rows[0].id}`, 'GET', undefined, token))
          .order === 0,
      `${mode}: upward drop did not persist`
    );
    pass(
      `${mode}: both edges scroll; manual wheel has priority; upward drop returns to the first position`
    );

    const cancelMoves = moves;
    await startDrag(card);
    await page.mouse.move(x, bounds.y + bounds.height - 20, { steps: 5 });
    await until(
      async () => (await viewport.evaluate(el => el.scrollTop)) > 80,
      'Cancel check never started edge scrolling'
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const stopped = await viewport.evaluate(el => el.scrollTop);
    await page.waitForTimeout(250);
    assert.equal(await viewport.evaluate(el => el.scrollTop), stopped);
    assert.equal(moves, cancelMoves);
    assert.equal(
      await page
        .locator(
          '.task-card-wrapper--drop-before, .task-card-wrapper--drop-after, .task-card[aria-hidden="true"]'
        )
        .count(),
      0
    );
    await card.click();
    await titleInput(page).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await titleInput(page).waitFor({ state: 'hidden' });
    pass(
      `${mode}: Escape cancels without saving; the next ordinary click opens the task`
    );
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (page)
    await page.screenshot({ path: `${artifactDir}/drag-scroll-failure.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
  await request(`/boards/${board.id}`, 'DELETE', undefined, token);
  writeFileSync(
    `${artifactDir}/drag-scroll-report.json`,
    JSON.stringify({ report, errors }, null, 2)
  );
}
