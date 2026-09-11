import {
  assert,
  playwright,
  fixture,
  request,
  newPage,
  until,
  artifactDir,
  titleInput,
  modal
} from './test-support.mjs';
import { writeFileSync } from 'node:fs';

const f = await fixture();
const token = f.tokens[0];
const board = await request(
  `/projects/${f.project.id}/boards`,
  'POST',
  {
    title: `ERP469 list ${Date.now()}`
  },
  token
);
const columns = [];
for (const title of ['List first', 'List second', 'List empty']) {
  columns.push(
    await request(
      `/boards/${board.id}/columns`,
      'POST',
      {
        title,
        ...(columns.length === 0 ? { color: '#77a6ff' } : {})
      },
      token
    )
  );
}
const rows = [];
for (let index = 0; index < 48; index++) {
  rows.push(
    await request(
      `/columns/${columns[0].id}/tasks`,
      'POST',
      {
        title:
          index === 47
            ? 'List long title ' + 'text '.repeat(35)
            : `List row ${index}`,
        priority: index === 47 ? 'high' : '',
        assigneeIds: index === 47 ? [f.users[1].id] : [],
        dueDate: index === 47 ? '2026-10-10T12:00:00.000Z' : null
      },
      token
    )
  );
}
const movable = await request(
  `/columns/${columns[1].id}/tasks`,
  'POST',
  {
    title: 'List movable task'
  },
  token
);
const browser = await playwright.chromium.launch({
  channel: 'chrome',
  headless: true
});
const report = [],
  errors = [],
  queries = [];
let pages = [];
/** Records the checked business outcome. */
const pass = name => {
  report.push(name);
  console.log(`PASS ${name}`);
};
/** Finds the existing group by its task container, independently of column order. */
const group = (page, id) =>
  page.getByTestId('ProjectPage-Column').filter({
    has: page.locator(`[data-column-id="${id}"]`)
  });
try {
  pages = await Promise.all(
    [0, 1].map(index => newPage(browser, f, index, errors))
  );
  const [a, b] = pages;
  for (const page of pages) {
    await page
      .getByTestId('ProjectPage-BoardItem')
      .filter({ hasText: board.title })
      .click();
    await page
      .getByText(rows.at(-1).title, { exact: true })
      .waitFor({ timeout: 20000 });
  }
  a.on('request', req => {
    const url = new URL(req.url());
    if (/\/columns\/\d+\/tasks$/.test(url.pathname))
      queries.push(url.toString());
  });
  await a.getByTestId('TaskBoardViewSwitch-List').click();
  await until(
    async () =>
      (await a.getByTestId('ProjectPage-Columns').getAttribute('data-view')) ===
      'list',
    'List view did not activate'
  );
  for (const zoom of [1, 0.75, 1.25, 1.5]) {
    await a.evaluate(zoom => {
      document.documentElement.style.zoom = String(zoom);
    }, zoom);
    const metrics = await a.evaluate(() => {
      const rect = selector =>
        document.querySelector(selector).getBoundingClientRect();
      const sw = document.querySelector('[data-testid="TaskBoardViewSwitch"]');
      const groups = [
        ...document.querySelectorAll('[data-testid="ProjectPage-Column"]')
      ];
      const search = rect('.task-board-filters__control--search');
      const settings = rect('.task-board-filters__control--settings');
      const buttons = [...sw.querySelectorAll('button')];
      return {
        search: search.width,
        sidebar: rect('.project-page__content').width,
        order:
          search.right <= settings.left &&
          settings.right <= sw.getBoundingClientRect().left,
        switch: [
          sw.getBoundingClientRect().width,
          sw.getBoundingClientRect().height
        ],
        padding: getComputedStyle(sw).padding,
        buttons: buttons.map(button => [
          button.getBoundingClientRect().width,
          button.getBoundingClientRect().height
        ]),
        icons: buttons.map(button => {
          const r = button.querySelector('svg').getBoundingClientRect();
          return [r.width, r.height];
        }),
        active: getComputedStyle(buttons[1]).backgroundColor,
        activeIcon: getComputedStyle(buttons[1]).color,
        inactive: getComputedStyle(buttons[0]).backgroundColor,
        rows: [...groups[0].querySelectorAll('.task-card')].map(
          el => el.getBoundingClientRect().height
        ),
        headers: groups.map(
          el =>
            el.querySelector('.board-column__header').getBoundingClientRect()
              .height
        ),
        gaps: groups
          .slice(1)
          .map(
            (el, i) =>
              el.getBoundingClientRect().top -
              groups[i].getBoundingClientRect().bottom
          ),
        border: getComputedStyle(groups[0]).borderTopWidth,
        colorBorder: getComputedStyle(
          groups[0].querySelector('.board-column__header'),
          '::before'
        ).width,
        color: getComputedStyle(
          groups[0].querySelector('.board-column__header'),
          '::before'
        ).backgroundColor,
        white: getComputedStyle(
          groups[1].querySelector('.board-column__header'),
          '::before'
        ).backgroundColor,
        headerBorders: groups.map(el => {
          const css = getComputedStyle(
            el.querySelector('.board-column__header')
          );
          return [css.borderTopWidth, css.borderBottomWidth];
        }),
        bodyGap:
          groups[0].querySelector('.board-column__body').getBoundingClientRect()
            .top -
          groups[0]
            .querySelector('.board-column__header')
            .getBoundingClientRect().bottom,
        widthDifference:
          groups[0].getBoundingClientRect().width -
          document.querySelector('[data-testid="ProjectPage-Columns"]')
            .clientWidth *
            Number(getComputedStyle(document.documentElement).zoom)
      };
    });
    const near = (actual, expected) =>
      assert.ok(
        Math.abs(actual - expected) <= 1,
        `${actual} != ${expected}; zoom ${zoom}`
      );
    near(metrics.search, metrics.sidebar);
    assert.ok(metrics.order, 'Search/settings/view order differs');
    metrics.switch.forEach((value, index) =>
      near(value, [90, 50][index] * zoom)
    );
    metrics.buttons.flat().forEach(value => near(value, 40 * zoom));
    metrics.icons.flat().forEach(value => near(value, 16 * zoom));
    metrics.rows
      .concat(metrics.headers)
      .forEach(value => near(value, 50 * zoom));
    metrics.gaps.forEach(value => near(value, 8 * zoom));
    near(metrics.bodyGap, 0);
    near(metrics.widthDifference, 0);
    assert.equal(metrics.padding, '5px');
    near(Number.parseFloat(metrics.border), 0);
    assert.ok(metrics.headerBorders.flat().every(value => value === '0px'));
    near(Number.parseFloat(metrics.colorBorder) * zoom, 5 * zoom);
    assert.equal(metrics.color, 'rgb(119, 166, 255)');
    assert.equal(metrics.white, 'rgb(255, 255, 255)');
    assert.equal(metrics.active, 'rgb(119, 166, 255)');
    assert.equal(metrics.activeIcon, 'rgb(255, 255, 255)');
    assert.equal(metrics.inactive, 'rgb(255, 255, 255)');
  }
  await a.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });
  await a.screenshot({ path: `${artifactDir}/list-view-expanded.png` });
  pass(
    'search/sidebar widths, control order, switch 90x50, buttons 40x40, icons 16x16, rows 50, groups gap 8 and borders match at 75–150%'
  );

  const firstGroup = group(a, columns[0].id);
  /** Captures geometry of the same title and both ends of the colored strip. */
  const groupShape = () =>
    firstGroup.evaluate(el => {
      const header = el.querySelector('.board-column__header');
      const body = el.querySelector('.board-column__body');
      const title = el
        .querySelector('.board-column__title')
        .getBoundingClientRect();
      const headStrip = getComputedStyle(header, '::before');
      const bodyStrip = getComputedStyle(body, '::before');
      return {
        title: [title.x, title.y, title.width, title.height],
        header: [
          headStrip.borderTopLeftRadius,
          headStrip.borderBottomLeftRadius
        ],
        bottom: bodyStrip.borderBottomLeftRadius,
        straight: [headStrip.borderWidth, bodyStrip.borderWidth],
        lastRight: getComputedStyle(
          body.querySelector('.task-card-wrapper:last-of-type .task-card')
        ).borderBottomRightRadius
      };
    });
  const expanded = await groupShape();
  await a.getByTestId(`ProjectPage-ColumnToggle-${columns[0].id}`).click();
  const collapsed = await groupShape();
  await a.getByTestId(`ProjectPage-ColumnToggle-${columns[0].id}`).click();
  const reopened = await groupShape();
  assert.deepEqual(expanded.title, collapsed.title);
  assert.deepEqual(expanded.title, reopened.title);
  assert.deepEqual(expanded.header, ['5px', '0px']);
  assert.deepEqual(collapsed.header, ['5px', '5px']);
  assert.equal(expanded.bottom, '5px');
  assert.equal(expanded.lastRight, '5px');
  assert.deepEqual(expanded.straight, ['0px', '0px']);

  // Capture the actual transition, not only the final transparent state.
  const frames = await a.evaluate(async () => {
    document.querySelector('[data-testid="TaskBoardViewSwitch-Cards"]').click();
    const frames = [];
    for (let index = 0; index < 15; index++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      frames.push(
        [...document.querySelectorAll('.board-column__body')].map(
          el => getComputedStyle(el).borderColor
        )
      );
    }
    return frames;
  });
  assert.ok(
    frames.flat().every(color => color === 'rgba(0, 0, 0, 0)'),
    JSON.stringify(frames)
  );
  await a.getByTestId('TaskBoardViewSwitch-List').click();
  pass(
    'title stays in place on collapse, strip has straight joins and correct corner ownership; no black border in any switch animation frame'
  );

  const viewport = a.getByTestId('ProjectPage-Columns');
  await until(
    async () => {
      const count = await group(a, columns[0].id)
        .getByTestId('TaskCard')
        .count();
      if (count === rows.length) return true;
      await viewport.evaluate(el => {
        el.scrollTop = el.scrollHeight;
      });
      return false;
    },
    'Vertical list scrolling did not load all 48 tasks',
    30000
  );
  assert.ok(
    queries.every(url => Number(new URL(url).searchParams.get('limit')) <= 100)
  );
  pass(
    'common vertical scrolling loads every task without changing zoom or duplicating rows'
  );

  /** Starts a drag with mouse input; no synthetic drop or scrolling to its target. */
  const startDrag = async locator => {
    await locator.scrollIntoViewIfNeeded();
    const rect = await locator.boundingBox();
    await a.mouse.move(rect.x + 10, rect.y + rect.height / 2);
    await a.mouse.down();
    await a.mouse.move(rect.x + 22, rect.y + rect.height / 2 + 8, { steps: 5 });
    await a.mouse.move(rect.x + 24, rect.y + rect.height / 2 + 8);
  };
  /** Releases the drag over a currently visible target. */
  const finishDrag = async locator => {
    const rect = await locator.boundingBox();
    await a.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, {
      steps: 5
    });
    await a.mouse.move(rect.x + rect.width / 2 + 1, rect.y + rect.height / 2);
    await a.mouse.up();
  };
  await viewport.evaluate(el => {
    el.scrollTop = 0;
  });
  const longMove = rows.at(-1);
  const viewportBounds = await viewport.boundingBox();
  /** Enters the edge and emits dragover after dragenter, as continuous mouse input does. */
  const hoverDragEdge = async y => {
    const x = viewportBounds.x + viewportBounds.width / 2;
    await a.mouse.move(x, y, { steps: 10 });
    await a.mouse.move(x + 1, y);
  };
  await startDrag(a.getByText(longMove.title, { exact: true }));
  await hoverDragEdge(viewportBounds.y + viewportBounds.height - 20);
  await until(
    async () => {
      const header = await group(a, columns[2].id)
        .locator('.board-column__header')
        .boundingBox();
      return (
        header.y + header.height < viewportBounds.y + viewportBounds.height
      );
    },
    'Holding the task 20px from the lower edge did not reach the offscreen group',
    20000
  );
  await finishDrag(group(a, columns[2].id).locator('.board-column__header'));
  await until(
    async () =>
      (await request(`/tasks/${longMove.id}`, 'GET', undefined, token))
        .columnId === columns[2].id,
    'Drop after downward autoscroll did not persist'
  );
  await until(
    async () =>
      (await group(b, columns[2].id)
        .getByText(longMove.title, { exact: true })
        .count()) === 1,
    'Long-list move did not reach the other user'
  );

  await startDrag(
    group(a, columns[2].id).getByText(longMove.title, { exact: true })
  );
  await hoverDragEdge(viewportBounds.y + 20);
  await until(
    async () => (await viewport.evaluate(el => el.scrollTop)) === 0,
    'Holding the task 20px from the upper edge did not reach the first group',
    20000
  );
  await finishDrag(group(a, columns[0].id).locator('.board-column__header'));
  await until(
    async () =>
      (await request(`/tasks/${longMove.id}`, 'GET', undefined, token))
        .columnId === columns[0].id,
    'Drop after upward autoscroll did not persist'
  );
  await until(
    async () =>
      (await group(a, columns[0].id).getByTestId('TaskCard').count()) === 48,
    'Returning the task lost or duplicated a list row'
  );
  pass(
    'task drag scrolls down and up from 20px inside the viewport, persists offscreen moves and synchronizes with the other user'
  );

  await viewport.evaluate(el => {
    el.scrollTop = 0;
  });
  await a
    .getByText(rows[46].title, { exact: true })
    .dragTo(a.getByText(rows[45].title, { exact: true }));
  await until(
    async () =>
      (await request(`/tasks/${rows[46].id}`, 'GET', undefined, token))
        .order === 1,
    'Dragging between occupied rows did not save the new order'
  );
  await startDrag(a.getByText(rows[46].title, { exact: true }));
  await hoverDragEdge(viewportBounds.y + viewportBounds.height - 20);
  await until(
    async () => (await viewport.evaluate(el => el.scrollTop)) > 80,
    'Cancel check did not start autoscroll'
  );
  await a.keyboard.press('Escape');
  await a.mouse.up();
  await a.waitForTimeout(150);
  const stoppedAt = await viewport.evaluate(el => el.scrollTop);
  await a.waitForTimeout(300);
  assert.equal(await viewport.evaluate(el => el.scrollTop), stoppedAt);
  assert.equal(
    await a
      .locator(
        '.task-card-wrapper--drop-before, .task-card-wrapper--drop-after, .board-column--dragging'
      )
      .count(),
    0
  );
  pass(
    'dragging between occupied rows saves order; Escape stops drag scrolling and clears target highlights'
  );

  await viewport.evaluate(el => {
    el.scrollTop = 0;
  });
  await a.getByTestId(`ProjectPage-ColumnToggle-${columns[0].id}`).click();
  assert.equal(
    await group(a, columns[0].id).locator('.board-column__body').isVisible(),
    false
  );
  assert.equal(
    (
      await group(a, columns[0].id)
        .locator('.board-column__tasks-count')
        .innerText()
    ).trim(),
    '48'
  );
  await a.screenshot({ path: `${artifactDir}/list-view-collapsed.png` });
  const source = a.getByText(movable.title, { exact: true });
  await source.dragTo(group(a, columns[2].id).locator('.board-column__header'));
  await until(
    async () =>
      (await request(`/tasks/${movable.id}`, 'GET', undefined, token))
        .columnId === columns[2].id,
    'Drop on empty group did not move task'
  );
  await until(
    async () =>
      (await group(b, columns[2].id)
        .getByText(movable.title, { exact: true })
        .count()) === 1,
    'Move did not reach card view of another user'
  );
  pass(
    'collapse preserves counts and tasks; moving into empty group synchronizes with another user in card view'
  );

  await startDrag(group(a, columns[0].id).locator('.board-column__title'));
  const occupiedRow = await group(a, columns[2].id)
    .getByText(movable.title, { exact: true })
    .boundingBox();
  await a.mouse.move(
    occupiedRow.x + 10,
    occupiedRow.y + occupiedRow.height / 2,
    { steps: 10 }
  );
  await a.mouse.move(
    occupiedRow.x + 11,
    occupiedRow.y + occupiedRow.height / 2
  );
  await until(
    async () =>
      (await group(a, columns[2].id).getAttribute('class')).includes(
        'board-column--drag-over'
      ),
    'A task row swallowed the target highlight for a dragged column'
  );
  await a.mouse.up();
  await until(
    async () =>
      (
        await request(`/boards/${board.id}/columns`, 'GET', undefined, token)
      ).at(-1).id === columns[0].id,
    'Dropping a column on an occupied row did not reorder groups'
  );
  await group(a, columns[0].id)
    .locator('.board-column__title')
    .dragTo(group(a, columns[1].id).locator('.board-column__title'));
  await until(
    async () =>
      (await request(`/boards/${board.id}/columns`, 'GET', undefined, token))[0]
        .id === columns[0].id,
    'Returning the group to its original position did not persist'
  );
  pass(
    'column title drags over occupied rows with visible target feedback and canonical saved ordering'
  );

  await group(a, columns[0].id).getByTestId('ProjectPage-ColumnMenu').click();
  const colorButton = group(a, columns[0].id)
    .locator('.column-popover__color')
    .nth(1);
  await colorButton.click();
  await until(async () => {
    const color = await group(a, columns[0].id).evaluate(
      el =>
        getComputedStyle(el.querySelector('.board-column__header'), '::before')
          .backgroundColor
    );
    const remoteColor = await group(b, columns[0].id)
      .locator('.board-column__header')
      .evaluate(el => getComputedStyle(el).borderBottomColor);
    return (
      color !== 'rgb(119, 166, 255)' &&
      color !== 'rgb(255, 255, 255)' &&
      color === remoteColor
    );
  }, 'Column color did not synchronize between list and cards');
  await colorButton.click();
  await until(
    async () =>
      (await group(a, columns[0].id).evaluate(
        el =>
          getComputedStyle(
            el.querySelector('.board-column__header'),
            '::before'
          ).backgroundColor
      )) === 'rgb(255, 255, 255)',
    'Removing color did not restore white border'
  );
  await group(a, columns[0].id).getByTestId('ProjectPage-ColumnMenu').click();
  pass(
    'existing column menu changes color in both views and restores white border when cleared'
  );

  await group(a, columns[1].id)
    .locator('.board-column__header')
    .dragTo(group(a, columns[0].id).locator('.board-column__header'));
  await until(
    async () =>
      (await request(`/boards/${board.id}/columns`, 'GET', undefined, token))[0]
        .id === columns[1].id,
    'Dragging a list header did not reorder groups'
  );
  pass('dragging a group header preserves canonical column ordering');

  const add = a.getByTestId('ProjectPage-AddColumn');
  const placement = await add.evaluate(el => ({
    top: el.getBoundingClientRect().top,
    bottom: [...document.querySelectorAll('[data-testid="ProjectPage-Column"]')]
      .at(-1)
      .getBoundingClientRect().bottom
  }));
  assert.ok(placement.top >= placement.bottom + 7);
  await add.click();
  await a
    .getByTestId('ProjectPage-AddColumnInput')
    .fill('List column created below groups');
  await a.getByTestId('ProjectPage-AddColumnInput').press('Enter');
  await a
    .getByText('List column created below groups', { exact: true })
    .waitFor();
  const createdColumns = await request(
    `/boards/${board.id}/columns`,
    'GET',
    undefined,
    token
  );
  const addedColumn = createdColumns.find(
    column => column.title === 'List column created below groups'
  );
  assert.ok(addedColumn);
  await group(a, addedColumn.id).getByTestId('ProjectPage-ColumnAdd').click();
  await titleInput(a).fill('Task created in list group');
  await titleInput(a).press('Control+s');
  await titleInput(a).waitFor({ state: 'hidden', timeout: 15000 });
  await group(a, addedColumn.id)
    .getByText('Task created in list group', { exact: true })
    .waitFor();
  pass(
    'separate Add column button is below all groups; canonical column/task creation remains available'
  );

  await group(a, columns[2].id)
    .getByText(movable.title, { exact: true })
    .click();
  await titleInput(a).fill('List edit synchronized');
  await a.keyboard.press('Escape');
  await titleInput(a).waitFor({ state: 'hidden', timeout: 15000 });
  await b
    .getByText('List edit synchronized', { exact: true })
    .waitFor({ timeout: 15000 });
  await a.getByTestId('TaskBoardViewSwitch-Cards').click();
  assert.equal(
    await group(a, columns[0].id).locator('.board-column__body').isVisible(),
    true
  );
  assert.equal(
    await group(a, columns[0].id).getByTestId('TaskCard').count(),
    48
  );
  await a.getByTestId('TaskBoardViewSwitch-List').click();
  assert.equal(
    await group(a, columns[0].id).locator('.board-column__body').isVisible(),
    false
  );
  pass(
    'opening/autosaving a list row synchronizes with cards; switching views retains loaded tasks and collapsed groups'
  );

  await a
    .getByRole('button', { name: 'Свернуть или развернуть панель досок' })
    .click();
  await until(
    async () =>
      a.evaluate(() => {
        const search = document
          .querySelector('.task-board-filters__control--search')
          .getBoundingClientRect();
        const sidebar = document
          .querySelector('.project-page__content')
          .getBoundingClientRect();
        return (
          Math.abs(search.width - 263) < 1 && Math.abs(sidebar.width - 64) < 1
        );
      }),
    'Search must stay 263px wide when the sidebar collapses to 64px'
  );
  await a
    .getByRole('button', { name: 'Свернуть или развернуть панель досок' })
    .click();
  await a
    .getByTestId('TaskBoardFilters-Search')
    .locator('input')
    .fill('List edit synchronized');
  await until(
    async () => (await a.locator('.task-card:visible').count()) === 1,
    'Search in list view did not apply'
  );
  assert.equal(
    await a.locator('.task-card:visible .task-card__title').innerText(),
    'List edit synchronized'
  );
  pass(
    'search keeps its width during sidebar collapse and uses existing task filters in list view'
  );
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (pages[0])
    await pages[0].screenshot({ path: `${artifactDir}/list-view-failure.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
  await request(`/boards/${board.id}`, 'DELETE', undefined, token);
  writeFileSync(
    `${artifactDir}/list-view-report.json`,
    JSON.stringify({ report, errors }, null, 2)
  );
}
