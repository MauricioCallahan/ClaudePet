import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Launches the real app with ClaudeBridge pointed at a fake claude CLI (e2e/fixtures), so no real Claude is used.
// The fake is a .cmd shim around node, like an npm-installed claude, which is the hard case for spawning and killing.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;
const SESSION = '11111111-2222-4333-8444-555555555555';
const lastReply = () => page.locator('#messages .msg.claude').last();
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });

async function send(text: string): Promise<void> {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function hang(): Promise<number> {
  // Wait for a new reply element: the previous reply may be an earlier /hang with a dead pid.
  const reply = page.locator('#messages .msg.claude').nth(await page.locator('#messages .msg.claude').count());
  await send('/hang');
  await expect(reply).toContainText(/pid=\d+;/, { timeout: 30_000 });
  const pid = Number(/pid=(\d+);/.exec(await reply.innerText())![1]);
  expect(alive(pid)).toBe(true);
  return pid;
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
  await app?.close().catch(() => {}); // the last test already quit the app
  fs.rmSync(profile, { recursive: true, force: true });
});

test('a reply streams in from the claude process, which runs in the app workspace folder', async () => {
  await send('hello & "quoted" %PATH%');
  await idle();
  await expect(lastReply()).toContainText('fresh: hello & "quoted" %PATH%'); // the prompt arrives untouched by the shell
  expect(fs.existsSync(path.join(profile, 'workspace'))).toBe(true);
});

test('a follow-up resumes the session from the first reply', async () => {
  await send('again');
  await idle();
  await expect(lastReply()).toContainText(`resumed ${SESSION}: again`);
  const chats = JSON.parse(fs.readFileSync(path.join(profile, 'chats.json'), 'utf8'));
  expect(chats[0].sessionId).toBe(SESSION);
});

test('a failing claude process ends the reply with its error and frees the input', async () => {
  await send('/fail');
  await idle();
  await expect(page.locator('#messages')).toContainText('claude exited with code 1: fake claude failed');
});

test('Stop ends the reply at once and kills the process', async () => {
  const pid = await hang();
  await page.click('#send'); // shows Stop while a reply is running
  await idle();
  await expect.poll(() => alive(pid)).toBe(false);
});

test('quitting the app leaves no claude process behind', async () => {
  const pid = await hang();
  await app.evaluate(({ app }) => app.quit()).catch(() => {}); // the connection drops as the app exits
  await expect.poll(() => alive(pid)).toBe(false);
});
