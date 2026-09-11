import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  openTask,
  storedTask,
  modal
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
  {
    dueDate: '2026-10-10T12:00:00.000Z',
    priority: 'medium',
    assigneeIds: [f.users[0].id]
  },
  f.tokens[0]
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [],
  coveredPairs = [];
let page, childId;
/** Records a completed user interaction scenario. */
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
/** Checks that exactly the requested field panel is visible. */
const only = async (fields, current) => {
  await until(
    async () => {
      const visibility = await Promise.all(
        fields.map(field => field.panel.isVisible())
      );
      return visibility.every(
        (visible, index) => visible === (index === current)
      );
    },
    `Expected only ${fields[current]?.name ?? 'no panel'} to remain open`
  );
};
/** Uses a real pointer where exposed, or the existing Enter action for focusable controls. */
const activate = async field => {
  const pointer = await field.trigger.evaluate(el => {
    const r = el.getBoundingClientRect();
    for (const x of [r.width / 2, 2, r.width - 2]) {
      for (const y of [r.height / 2, 2, r.height - 2]) {
        if (el.contains(document.elementFromPoint(r.left + x, r.top + y)))
          return { x, y };
      }
    }
    return null;
  });
  if (pointer) await field.trigger.click({ position: pointer });
  else {
    if (
      !(await field.trigger.evaluate(el =>
        el.matches('button, [tabindex="0"]')
      ))
    )
      return false;
    await field.trigger.focus();
    await field.trigger.press('Enter');
  }
  return true;
};
try {
  page = await newPage(browser, f, 0, errors);
  const other = await newPage(browser, f, 1, errors);
  for (const mode of ['cards', 'list', 'modal']) {
    await page
      .getByTestId(
        mode === 'cards'
          ? 'TaskBoardViewSwitch-Cards'
          : 'TaskBoardViewSwitch-List'
      )
      .click();
    if (mode === 'modal') await openTask(page, f.task.id);
    const scope = page
      .locator(mode === 'modal' ? 'dialog[open]' : '.task-card')
      .first();
    const fields = [
      {
        name: 'calendar',
        trigger: scope.locator('.date-picker-yui-kit__header-btn').first(),
        panel: page.locator('.task-board-calendar-popover')
      },
      {
        name: 'assignees',
        trigger: scope
          .locator(
            mode === 'modal'
              ? '.board-user-filter .filter__header'
              : '.board-user-filter__avatar-trigger'
          )
          .first(),
        panel: page.locator('.board-user-filter__options')
      },
      {
        name: 'priority',
        trigger: scope.locator('.priority-select__trigger').first(),
        panel: page.locator('.priority-select__dropdown')
      }
    ];
    if (mode === 'modal')
      fields.push(
        {
          name: 'tags',
          trigger: scope.locator('.tags-select__trigger').first(),
          panel: page.locator('.tags-select__dropdown')
        },
        {
          name: 'approval',
          trigger: scope.locator(
            '.task-modal__approval-tag .filter-yui-kit__wrapper'
          ),
          panel: scope.locator(
            '.task-modal__approval-tag .filter-yui-kit__select-wrapper'
          )
        },
        {
          name: 'column',
          trigger: page.getByTestId(`${modal}-LocationPicker-Column-Current`),
          panel: page.getByTestId(`${modal}-LocationPicker-Column-OptionsList`)
        },
        {
          name: 'parent',
          trigger: scope.locator('.task-modal__parent-filter .filter__header'),
          panel: scope.locator('.task-modal__parent-filter .filter__options')
        }
      );
    for (let i = 0; i < fields.length; i++) {
      await fields[i].trigger.click();
      await only(fields, i);
      await fields[i].trigger.click();
      await only(fields, -1);
    }
    pass(`${mode}: repeated trigger clicks close each field panel`);
    for (let from = 0; from < fields.length; from++) {
      for (let to = 0; to < fields.length; to++) {
        if (from === to) continue;
        await fields[from].trigger.click();
        await only(fields, from);
        if (!(await activate(fields[to]))) {
          // A fully covered control cannot be clicked; do not bypass the real UI with dispatchEvent.
          coveredPairs.push({
            mode,
            from: fields[from].name,
            to: fields[to].name
          });
          await fields[from].trigger.click();
          await only(fields, -1);
          continue;
        }
        await only(fields, to);
        await fields[to].trigger.click();
        await only(fields, -1);
      }
    }
    pass(
      `${mode}: switching between reachable field triggers leaves only the new panel open`
    );
    await fields[0].trigger.click();
    await page.locator('col-cal').getByText('15', { exact: true }).click();
    await only(fields, -1);
    await until(
      async () =>
        new Date((await storedTask(other, f.task.id)).dueDate).getDate() === 15,
      'Date did not synchronize'
    );
    await fields[1].trigger.click();
    const search = fields[1].panel.locator('input').first();
    await search.fill(f.users[1].login);
    await only(fields, 1);
    await fields[1].panel
      .getByRole('button', { name: f.users[1].login, exact: false })
      .click();
    await only(fields, 1);
    await until(
      async () =>
        (await storedTask(other, f.task.id)).assigneeIds.includes(
          String(f.users[1].id)
        ),
      'Assignee did not synchronize'
    );
    await fields[1].trigger.click();
    await only(fields, -1);
    pass(
      `${mode}: day selection and assignee search/multiselect still save and synchronize`
    );
    // Restore selections before the next mode so each change remains meaningful.
    await request(
      `/tasks/${f.task.id}`,
      'PUT',
      { dueDate: '2026-10-10T12:00:00.000Z', assigneeIds: [f.users[0].id] },
      f.tokens[0]
    );
    await until(
      async () => (await storedTask(page, f.task.id)).assigneeIds.length === 1,
      'Fixture reset did not arrive'
    );
    if (mode === 'modal') await page.keyboard.press('Escape');
  }
  const cardCalendar = page
    .locator('.task-card .date-picker-yui-kit__header-btn')
    .first();
  await cardCalendar.dblclick();
  await page
    .locator('.task-board-calendar-popover')
    .waitFor({ state: 'hidden' });
  assert.equal(await page.locator('dialog[open]').count(), 0);
  pass('rapid double-click closes the calendar without opening the task');

  const child = await request(
    `/tasks/${f.task.id}/subtasks`,
    'POST',
    {
      title: 'Field popover child',
      dueDate: '2026-10-10T12:00:00.000Z',
      assigneeIds: [f.users[0].id]
    },
    f.tokens[0]
  );
  childId = child.id;
  await openTask(page, f.task.id);
  const mainCalendar = page.locator(
    '.task-modal__due-date .date-picker-yui-kit__header-btn'
  );
  const childCalendar = page
    .locator('.task-modal__subtask-row .date-picker-yui-kit__header-btn')
    .first();
  await childCalendar.waitFor();
  await mainCalendar.click();
  await activate({ name: 'subtask calendar', trigger: childCalendar });
  await until(
    async () =>
      (await page.locator('.date-active-yui-kit').count()) === 1 &&
      (await childCalendar.evaluate(el =>
        el.classList.contains('date-active-yui-kit')
      )),
    'Subtask calendar did not replace parent calendar'
  );
  assert.equal(await page.locator('.task-board-calendar-popover').count(), 1);
  await childCalendar.click();
  await page
    .locator('.task-board-calendar-popover')
    .waitFor({ state: 'hidden' });
  await childCalendar.click();
  const childAssignees = page
    .locator(
      '.task-modal__subtask-assignees .board-user-filter__avatar-trigger'
    )
    .first();
  await activate({ name: 'subtask assignees', trigger: childAssignees });
  await page
    .locator('.task-board-calendar-popover')
    .waitFor({ state: 'hidden' });
  await page.locator('.board-user-filter__options').waitFor();
  await activate({ name: 'parent calendar', trigger: mainCalendar });
  await page
    .locator('.board-user-filter__options')
    .waitFor({ state: 'hidden' });
  await page.locator('.task-board-calendar-popover').waitFor();
  await mainCalendar.locator('.date-picker-close-yui-kit').click();
  await page
    .locator('.task-board-calendar-popover')
    .waitFor({ state: 'hidden' });
  await until(
    async () => (await storedTask(other, f.task.id)).dueDate === null,
    'Date clear did not synchronize'
  );
  pass(
    'parent/subtask fields close each other; clearing a date retains the existing save action'
  );
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (page)
    await page.screenshot({
      path: `${artifactDir}/field-popovers-failure.png`
    });
  process.exitCode = 1;
} finally {
  await browser.close();
  if (childId)
    await request(`/tasks/${childId}`, 'DELETE', undefined, f.tokens[0]);
  await request(
    `/tasks/${f.task.id}`,
    'PUT',
    {
      dueDate: original.dueDate,
      priority: original.priority,
      assigneeIds: (original.assignees ?? []).map(user => user.id)
    },
    f.tokens[0]
  );
  writeFileSync(
    `${artifactDir}/field-popovers-report.json`,
    JSON.stringify({ report, errors, coveredPairs }, null, 2)
  );
}
