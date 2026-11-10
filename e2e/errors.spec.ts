import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Bullet 4: each failure shows a clear message (Retry for network and timeout), and lands in bridge.log.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;
let exe: string; // a copy of the fake claude, so a test can rename it away
let offline: string; // while this file exists, the fake claude has no network
const SECRET = 'paw-secret-42'; // in every prompt; must never reach the log
const lastReply = () => page.locator('#messages .msg.claude').last();
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });

async function send(text: string): Promise<void> {
  await page.fill('#input', `${text} ${SECRET}`);
  await page.press('#input', 'Enter');
  await idle();
}

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  const bin = path.join(profile, 'bin');
  fs.mkdirSync(bin);
  for (const f of ['fake-claude.cmd', 'fake-claude.js']) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(bin, f));
  exe = path.join(bin, 'fake-claude.cmd');
  offline = path.join(profile, 'offline');
  // Idle time: well above a cold cmd + node start (antivirus scans the fresh copy), or replies time out at random.
  const env = { ...process.env, CLAUDEPET_CLAUDE: exe, CLAUDEPET_IDLE_MS: '10000', FAKE_OFFLINE_FILE: offline };
  delete (env as NodeJS.ProcessEnv).CLAUDEPET_BRIDGE;
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
  page = await app.firstWindow();
  await expect(lastReply()).toHaveText(/ClaudePet/);
});
test.afterAll(async () => {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

test('a missing Claude Code says to install it, with the link', async () => {
  fs.renameSync(exe, exe + '.off');
  await send('hello');
  await expect(lastReply()).toContainText("Claude Code isn't installed.");
  await expect(lastReply().locator('a')).toHaveAttribute('href', 'https://claude.com/claude-code');
  fs.renameSync(exe + '.off', exe);
});

test('signed out says how to sign in', async () => {
  await send('/signedout');
  await expect(lastReply()).toContainText('Run `claude` once in a terminal and sign in');
  await expect(lastReply().locator('button.retry')).toHaveCount(0);
});

test('the usage limit says when it resets', async () => {
  await send('/limit');
  await expect(lastReply()).toContainText(/usage limit\. It resets \S/);
});

test('going offline shows the network error, and Retry works once back online', async () => {
  fs.writeFileSync(offline, '');
  await send('/offline');
  await expect(lastReply()).toContainText("Can't reach Claude.");
  fs.rmSync(offline);
  await lastReply().locator('button.retry').click();
  await idle();
  await expect(lastReply()).toContainText(`: /offline ${SECRET}`);
  await expect(page.locator('button.retry')).toHaveCount(0);
  await expect(page.locator('#messages .msg.user')).toHaveCount(4); // Retry did not add a second copy of the message
  const [chat] = JSON.parse(fs.readFileSync(path.join(profile, 'chats.json'), 'utf8'));
  const stored = JSON.parse(fs.readFileSync(path.join(profile, 'chats', `${chat.id}.json`), 'utf8'));
  expect(stored.filter((m: { text: string }) => m.text === `/offline ${SECRET}`)).toHaveLength(1); // nor in the store
});

test('no output for the idle time ends the reply with a timeout and Retry', async () => {
  await send('/hang');
  await expect(lastReply()).toContainText('Claude stopped responding.');
  await expect(lastReply().locator('button.retry')).toHaveCount(1);
});

test('errors land in bridge.log with time and case, without message text', async () => {
  const log = fs.readFileSync(path.join(profile, 'bridge.log'), 'utf8');
  const cases = log.trim().split('\n').map((l) => l.split(' ')[1]);
  expect(cases).toEqual(['not-installed', 'not-signed-in', 'usage-limit', 'network', 'timeout']);
  expect(log).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(log).not.toContain(SECRET);
});
