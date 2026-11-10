import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Launches the real app (FakeBridge, no Claude) with a throwaway profile so it never touches your chats
// or collides with a running ClaudePet. The tests share one app and run in order.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;
const lastReply = () => page.locator('#messages .msg.claude').last();

async function send(text: string): Promise<void> {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
}
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });
const scrollState = () => page.locator('#messages').evaluate((m) => ({ overflow: m.scrollHeight > m.clientHeight, top: m.scrollTop, gap: m.scrollHeight - m.scrollTop - m.clientHeight }));

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, CLAUDEPET_BRIDGE: 'fake' } });
  page = await app.firstWindow();
  await expect(lastReply()).toHaveText(/ClaudePet/); // the module script has run and its handlers are attached
});
test.afterAll(async () => {
  await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

test('a long reply streams, follows the bottom, and stops following once you scroll up', async () => {
  await send('/long');
  await expect(lastReply()).toContainText('word80', { timeout: 30_000 });
  const before = await scrollState();
  expect(before.overflow).toBe(true); // otherwise there is nothing to follow
  expect(before.gap).toBeLessThan(30);
  await page.locator('#messages').evaluate((m) => (m.scrollTop = 0));
  await expect(lastReply()).toContainText('word140', { timeout: 30_000 });
  expect((await scrollState()).top).toBeLessThan(30);
  await idle();
});

test('Markdown renders and a script in the reply does not run', async () => {
  await send('/md');
  await idle();
  await expect(lastReply().locator('h1')).toHaveText('Heading');
  await expect(lastReply().locator('li')).toHaveCount(2);
  await expect(lastReply().locator('pre code')).toContainText('const a = 1 < 2;');
  await expect(lastReply().locator('script')).toHaveCount(0);
  expect(await page.title()).toBe('ClaudePet');
});

test('Copy puts the exact code, and Copy reply the whole Markdown, on the clipboard', async () => {
  const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await lastReply().locator('button.copy').click();
  expect(await clipboard()).toBe('const a = 1 < 2;\n');
  await lastReply().locator('button.copy-reply').click();
  const whole = await clipboard();
  expect(whole.startsWith('# Heading\n')).toBe(true);
  expect(whole).toContain('```js');
});

test('messages show a time on hover', async () => {
  await lastReply().hover();
  expect(await lastReply().getAttribute('title')).toMatch(/\d{1,2}:\d{2}/);
});

// Last: Playwright waits on a cancelled navigation, so later actions on the page would hang.
test('a link opens in the browser and the box does not navigate', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as any).__opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  const before = page.url();
  await lastReply().locator('a').click({ noWaitAfter: true });
  await expect.poll(() => app.evaluate(() => (globalThis as any).__opened)).toEqual(['https://example.com/']);
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => document.querySelector('#messages h1')?.textContent)).toBe('Heading'); // the chat is still there
});
