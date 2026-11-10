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
