import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Bullet 5: chats survive a restart and can be reopened, continued, searched, renamed and deleted.
// Uses the fake claude CLI, whose replies say "resumed <id>" when the conversation continues.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;
const lastReply = () => page.locator('#messages .msg.claude').last();
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });
const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(profile, ...p), 'utf8'));

async function launch(): Promise<void> {
  const env = { ...process.env, CLAUDEPET_CLAUDE: path.join(__dirname, 'fixtures', 'fake-claude.cmd'), CLAUDE_CONFIG_DIR: path.join(profile, 'claude') };
  delete (env as NodeJS.ProcessEnv).CLAUDEPET_BRIDGE;
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
  page = await app.firstWindow();
  await expect(lastReply()).toHaveText(/ClaudePet/);
}
async function send(text: string): Promise<void> {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await idle();
}

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  await launch();
});
test.afterAll(async () => {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

test('messages are saved and survive a restart', async () => {
  await send('hello pancake');
  await expect(lastReply()).toContainText('fresh: hello pancake');
  const [chat] = readJson('chats.json');
  await app.close();
  await launch();
  expect(readJson('chats', `${chat.id}.json`).map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([
    ['user', 'hello pancake'],
    ['claude', 'fresh: hello pancake'],
  ]);
});

const rows = () => page.locator('#chat-list .title');

test('the chat list shows every chat, newest first', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('chat:new'));
  await send('second chat');
  await page.click('#chats-button');
  await expect(rows()).toHaveText(['second chat', 'hello pancake']);
  await expect(page.locator('#messages')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#chats')).toBeHidden();
  await expect(page.locator('#input')).toBeFocused();
});

test('a reopened chat shows its messages and continues the same conversation', async () => {
  await app.close();
  await launch();
  await page.click('#chats-button');
  await rows().filter({ hasText: 'hello pancake' }).click();
  await expect(page.locator('#messages .msg')).toHaveText(['hello pancake', /fresh: hello pancake/]);
  await send('what did I just ask?');
  await expect(lastReply()).toContainText('resumed 11111111-2222-4333-8444-555555555555: what did I just ask?');
});
