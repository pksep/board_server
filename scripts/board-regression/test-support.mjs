import playwright from 'playwright-core';
import { JwtService } from '@nestjs/jwt';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
export { assert, playwright };
export const artifactDir = resolve(
  process.env.BOARD_TEST_OUTPUT || '.test-artifacts/erp-469'
);
mkdirSync(artifactDir, { recursive: true });
const apiUrl = (
  process.env.BOARD_TEST_API_URL || 'http://127.0.0.1:3005/api'
).replace(/\/$/, '');
const uiUrl = (
  process.env.BOARD_TEST_UI_URL || 'http://localhost:8081'
).replace(/\/$/, '');
for (const url of [apiUrl, uiUrl]) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
    throw new Error(
      'These mutation tests require an isolated local environment.'
    );
}
if (!process.env.BOARD_TEST_JWT_SECRET)
  throw new Error(
    'Set BOARD_TEST_JWT_SECRET to the isolated Board API signing key.'
  );
const jwt = new JwtService({ secret: process.env.BOARD_TEST_JWT_SECRET });
const sign = user =>
  jwt.sign({ id: user.id, login: user.login }, { expiresIn: '2h' });

/** Uses canonical Board endpoints against the explicitly configured local API. */
export async function request(path, method = 'GET', body, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: new URL(uiUrl).origin,
      ...(token ? { Cookie: `board_token=${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const content = await response.text();
  const data = content ? JSON.parse(content) : null;
  if (!response.ok)
    throw new Error(
      `${method} ${path}: ${response.status} ${JSON.stringify(data)}`
    );
  return data;
}
const fixtureFile = `${artifactDir}/regression-fixture.json`;

/** Reuses only this suite's fixture; tokens remain in memory and never enter artifacts. */
export async function fixture() {
  if (existsSync(fixtureFile)) {
    const data = JSON.parse(readFileSync(fixtureFile, 'utf8'));
    return { ...data, tokens: data.users.map(sign) };
  }
  const stamp = Date.now();
  const users = [];
  for (let i = 0; i < 2; i++)
    users.push(
      await request('/users', 'POST', {
        initial: `ERP469 tester ${i}`,
        login: `ERP469 tester ${i}`,
        serviceNumber: `ERP469-${stamp}-${i}`
      })
    );
  const token = sign(users[0]);
  const project = await request(
    '/projects',
    'POST',
    {
      title: `ERP469 regression ${stamp}`,
      prefix:
        'REG' +
        Array.from({ length: 6 }, () =>
          String.fromCharCode(65 + Math.random() * 26)
        ).join(''),
      membersIds: users.map(u => u.id)
    },
    token
  );
  const board = await request(
    `/projects/${project.id}/boards`,
    'POST',
    { title: 'ERP469 regression' },
    token
  );
  const column = await request(
    `/boards/${board.id}/columns`,
    'POST',
    { title: 'Edits' },
    token
  );
  const childColumn = await request(
    `/boards/${board.id}/columns`,
    'POST',
    { title: 'Children' },
    token
  );
  const task = await request(
    `/columns/${column.id}/tasks`,
    'POST',
    {
      title: 'Autosave regression',
      description: '<p>Original description</p>'
    },
    token
  );
  const data = { users, project, board, column, childColumn, task };
  writeFileSync(fixtureFile, JSON.stringify(data, null, 2));
  return { ...data, tokens: users.map(sign) };
}

/** Creates a separate user session; ERP shell is mocked, Board HTTP and WebSockets remain real. */
export async function newPage(browser, f, i, errors = [], filters) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 }
  });
  await context.addCookies([
    {
      name: 'board_token',
      value: f.tokens[i],
      domain: new URL(uiUrl).hostname,
      path: '/'
    }
  ]);
  await context.addInitScript(
    ({ user, projectId, filters }) => {
      localStorage.setItem(
        'auth',
        JSON.stringify({
          ...user,
          role: { id: 1, name: 'Local test', accesses: {} },
          image: null
        })
      );
      if (filters)
        localStorage.setItem(
          `task-board-filters:${projectId}`,
          JSON.stringify(filters)
        );
      window.__testSockets = [];
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(...args) {
          super(...args);
          window.__testSockets.push(this);
        }
      };
    },
    { user: f.users[i], projectId: f.project.id, filters }
  );
  await context.route('**/dev-erp-api/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], count: 0, accesses: {} })
    })
  );
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${uiUrl}/projects/${f.project.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.locator('.task-card-wrapper').first().waitFor({ timeout: 60000 });
  return page;
}

/** Polls a business outcome with a bounded timeout. */
export async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 100));
  } while (Date.now() < end);
  throw new Error(message);
}
export const modal = 'ProjectPage-CreateTaskModal';
export const titleInput = page =>
  page
    .getByTestId(`${modal}-TitleInput`)
    .locator('input')
    .or(page.locator(`input[data-testid="${modal}-TitleInput"]`));
export const editor = page =>
  page.locator('dialog[open] .tiptap.ProseMirror').first();
export const status = page => page.getByTestId(modal);

/** Opens through the application's supported task deep link. */
export async function openTask(page, taskId) {
  await page.evaluate(
    id =>
      document
        .querySelector('[data-testid="ProjectPage"]')
        .__vueParentComponent.appContext.config.globalProperties.$router.push({
          query: { task: String(id) }
        }),
    taskId
  );
  await page.getByTestId(`${modal}-TitleInput`).waitFor({ timeout: 15000 });
}

/** Reads the same reactive task snapshot used by cards and open modals. */
export async function storedTask(page, id) {
  return page.evaluate(
    id =>
      document
        .querySelector('[data-testid="ProjectPage"]')
        .__vueParentComponent.appContext.config.globalProperties.$pinia._s.get(
          'task_board'
        )
        .tasks.find(t => t.id === id),
    id
  );
}
