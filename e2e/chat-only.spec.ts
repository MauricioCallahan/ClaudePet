import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Chat mode: checks how the bridge starts the (fake) claude CLI. "/args" makes the fake reply with its argv and cwd.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;
const lastReply = () => page.locator('#messages .msg.claude').last();
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });

async function send(text: string): Promise<void> {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
}
async function started(): Promise<{ args: string[]; cwd: string }> {
  await send('/args');
  await idle();
  return JSON.parse((await lastReply().locator('pre code').textContent())!);
}

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  const env = { ...process.env, CLAUDEPET_CLAUDE: path.join(__dirname, 'fixtures', 'fake-claude.cmd') };
  delete (env as NodeJS.ProcessEnv).CLAUDEPET_BRIDGE;
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
  page = await app.firstWindow();
  await expect(lastReply()).toHaveText(/ClaudePet/);
});
test.afterAll(async () => {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

test('tools and the user setup are off, and the empty values survive the .cmd shim', async () => {
  const { args } = await started();
  expect(args[args.indexOf('--tools') + 1]).toBe('');
  expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
  expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands']));
});

test('claude runs in the empty workspace folder inside the app data, not a home or repo folder', async () => {
  const { cwd } = await started();
  expect(path.resolve(cwd).toLowerCase()).toBe(path.join(profile, 'workspace').toLowerCase());
  expect(fs.readdirSync(cwd)).toEqual([]);
});
