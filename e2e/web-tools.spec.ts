import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The web tools setting reaches the (fake) claude CLI's arguments. "/args" makes the fake reply with its argv.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;
const lastReply = () => page.locator('#messages .msg.claude').last();
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });
const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function started(): Promise<string[]> {
  await page.fill('#input', '/args');
  await page.press('#input', 'Enter');
  await idle(); // Send comes back, so the reply ended normally
  return JSON.parse((await lastReply().locator('pre code').textContent())!).args;
}

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ ui: { compact: false } })); // full box
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

test('with no tools setting, no tools are offered or allowed', async () => {
  const args = await started();
  expect(flag(args, '--tools')).toBe('');
  expect(args).not.toContain('--allowedTools');
});

test('turning on web search applies to the next message, with no restart', async () => {
  const file = path.join(profile, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), tools: { webSearch: true } }));
  const args = await started();
  expect(flag(args, '--tools')).toBe('WebSearch');
  expect(flag(args, '--allowedTools')).toBe('WebSearch');
});
