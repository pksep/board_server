import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  openTask,
  storedTask
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';

const f = await fixture();
const original = await request(
  `/tasks/${f.task.id}`,
  'GET',
  undefined,
  f.tokens[0]
);
await request(
  `/tasks/${f.task.id}`,
  'PUT',
  { dueDate: '2026-10-10T12:00:00.000Z' },
  f.tokens[0]
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [],
  measurements = [];
let page;
/** Records an outcome verified through the real browser and Board API. */
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
/** Waits for a visible calendar to fit the viewport after positioning settles. */
const contained = async label => {
  let bounds;
  await until(async () => {
    bounds = await page.locator('.task-board-calendar-popover').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight
      };
    });
    return (
      bounds.left >= 8 &&
      bounds.right <= bounds.width - 8 &&
      bounds.top >= 8 &&
      bounds.bottom <= bounds.height - 8
    );
  }, `Calendar clipped: ${label}`);
  measurements.push({ label, ...bounds });
};
try {
  page = await newPage(browser, f, 0, errors);
  for (const mode of ['cards', 'list', 'modal']) {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1';
    });
    await page
      .getByTestId(
        mode === 'cards'
          ? 'TaskBoardViewSwitch-Cards'
          : 'TaskBoardViewSwitch-List'
      )
      .click();
    if (mode === 'modal') await openTask(page, f.task.id);
    const trigger =
      mode === 'modal'
        ? page.locator(
            '.task-modal__due-date [data-testid$="HeaderBtn-Trigger"]'
          )
        : page
            .locator(
              '.task-card__date [data-testid="Calendar-DataPicker-Choose-HeaderBtn-Trigger"]'
            )
            .first();
    /** Keeps outside-click coverage alongside the separate repeated-trigger regression. */
    const closeCalendar = async () => {
      if (mode === 'modal')
        await page
          .locator('.task-modal__attr-row')
          .filter({ has: page.locator('.task-modal__due-date') })
          .locator('.task-modal__attr-label')
          .click();
      else
        await page
          .getByTestId(
            mode === 'cards'
              ? 'TaskBoardViewSwitch-Cards'
              : 'TaskBoardViewSwitch-List'
          )
          .click();
      await page
        .locator('.task-board-calendar-popover')
        .waitFor({ state: 'hidden' });
    };
    for (const zoom of [0.75, 1, 1.25, 1.5]) {
      await page.evaluate(z => {
        document.documentElement.style.zoom = String(z);
      }, zoom);
      await trigger.click();
      await page.locator('.task-board-calendar-popover').waitFor();
      await contained(`${mode} at ${zoom}`);
      await page.screenshot({
        path: `${artifactDir}/calendar-fixed-${mode}-${zoom}.png`
      });
      await closeCalendar();
    }
    pass(`${mode} calendar stays inside all viewport edges at 75–150%`);
    await trigger.click();
    await page.locator('.task-board-calendar-popover').waitFor();
    await page.setViewportSize({ width: 900, height: 700 });
    await contained(`${mode} after resize while open`);
    await page.setViewportSize({ width: 1440, height: 950 });
    await contained(`${mode} after restoring viewport`);
    await closeCalendar();
    if (mode === 'modal') await page.keyboard.press('Escape');
  }
  pass(
    'an open calendar follows viewport resizing in cards, list and task modal'
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });
  const other = await newPage(browser, f, 1, errors);
  await page
    .locator(
      '.task-card__date [data-testid="Calendar-DataPicker-Choose-HeaderBtn-Trigger"]'
    )
    .first()
    .click();
  await page.locator('col-cal').getByText('15', { exact: true }).click();
  await until(
    async () =>
      new Date(
        (await request(`/tasks/${f.task.id}`, 'GET', undefined, f.tokens[0]))
          .dueDate
      ).getDate() === 15,
    'Date choice did not save'
  );
  await until(
    async () =>
      new Date((await storedTask(other, f.task.id)).dueDate).getDate() === 15,
    'Date choice did not reach the other user'
  );
  assert.equal(await page.locator('dialog[open]').count(), 0);
  pass(
    'choosing a day saves and synchronizes through the existing date action without opening the task'
  );
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (page)
    await page.screenshot({ path: `${artifactDir}/calendar-failure.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
  await request(
    `/tasks/${f.task.id}`,
    'PUT',
    { dueDate: original.dueDate },
    f.tokens[0]
  );
  writeFileSync(
    `${artifactDir}/calendar-report.json`,
    JSON.stringify({ report, errors, measurements }, null, 2)
  );
}
