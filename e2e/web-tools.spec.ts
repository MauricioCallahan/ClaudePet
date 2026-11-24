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

const setTools = (tools: object) => {
  const file = path.join(profile, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), tools }));
};

test('with no tools setting, both web tools are offered and allowed', async () => {
  const args = await started();
  expect(flag(args, '--tools')).toBe('WebSearch,WebFetch');
  expect(flag(args, '--allowedTools')).toBe('WebSearch,WebFetch');
});

test('turning web fetch off applies to the next message, with no restart', async () => {
  setTools({ webFetch: false });
  const args = await started();
  expect(flag(args, '--tools')).toBe('WebSearch');
  expect(flag(args, '--allowedTools')).toBe('WebSearch');
});

test('with both off, no tools are offered, and the empty value survives the .cmd shim', async () => {
  setTools({ webSearch: false, webFetch: false });
  const args = await started();
  expect(flag(args, '--tools')).toBe('');
  expect(args).not.toContain('--allowedTools');
});

test('an ask rule keeps the tool offered but not allowed, and passes the approval tool and its run config', async () => {
  setTools({ approval: { WebFetch: 'ask' } });
  const args = await started();
  expect(flag(args, '--tools')).toBe('WebSearch,WebFetch');
  expect(flag(args, '--allowedTools')).toBe('WebSearch');
  expect(flag(args, '--permission-prompt-tool')).toBe('mcp__claudepet__approve');
  expect(args).not.toContain('--permission-prompts');
  expect(flag(args, '--mcp-config')).toBe(path.join('..', 'mcp-run.json')); // relative to cwd, like the prompt file
  const run = JSON.parse(fs.readFileSync(path.join(profile, 'mcp-run.json'), 'utf8'));
  expect(Object.keys(run.mcpServers)).toEqual(['claudepet']);
  expect(run.mcpServers.claudepet.env.ELECTRON_RUN_AS_NODE).toBe('1');
});
