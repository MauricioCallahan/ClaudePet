import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The servers in mcp.json reach the (fake) claude CLI through mcp-run.json. "/args" makes the fake reply with its argv,
// and its init line lists the servers in --mcp-config like claude does.
test.describe.configure({ mode: 'serial' });

const SECRET = 's3cr3t-value';
let app: ElectronApplication;
let page: Page;
let profile: string;
const lastReply = () => page.locator('#messages .msg.claude').last();
const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });
const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = (name: string) => path.join(profile, name);
const log = () => (fs.existsSync(file('bridge.log')) ? fs.readFileSync(file('bridge.log'), 'utf8') : '');
const runServers = () => Object.keys(JSON.parse(fs.readFileSync(file('mcp-run.json'), 'utf8')).mcpServers);

async function send(text: string): Promise<void> {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await idle();
}
async function started(): Promise<string[]> {
  await send('/args');
  return JSON.parse((await lastReply().locator('pre code').textContent())!).args;
}
const setConnectors = (connectors: object) => fs.writeFileSync(file('settings.json'), JSON.stringify({ ui: { compact: false }, connectors }));

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  fs.writeFileSync(file('settings.json'), JSON.stringify({ ui: { compact: false } })); // full box
  fs.writeFileSync(
    file('mcp.json'),
    JSON.stringify({
      mcpServers: {
        echo: { command: 'node', args: [path.resolve('e2e/fixtures/echo-mcp.js')], env: { TOKEN: SECRET } },
        broken: { command: 'missing-command', env: { TOKEN: SECRET } },
      },
    }),
  );
  const env = { ...process.env, CLAUDEPET_CLAUDE: path.join(__dirname, 'fixtures', 'fake-claude.cmd') };
  delete (env as NodeJS.ProcessEnv).CLAUDEPET_BRIDGE;
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE; // set when run from inside VS Code; the app itself must start as Electron
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
  page = await app.firstWindow();
  await expect(lastReply()).toHaveText(/ClaudePet/);
});
test.afterAll(async () => {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

test('the servers in mcp.json go into mcp-run.json with the approval server, which cannot be replaced', async () => {
  const args = await started();
  expect(flag(args, '--mcp-config')).toBe(path.join('..', 'mcp-run.json')); // relative to cwd, like the prompt file
  expect(flag(args, '--permission-prompt-tool')).toBe('mcp__claudepet__approve');
  expect(args).toContain('--strict-mcp-config');
  expect(runServers()).toEqual(['echo', 'broken', 'claudepet']);
});

test('the status of each server is read from the init line, and a failed one is logged without its secrets', async () => {
  const status = await app.evaluate(({}, f) => process.mainModule!.require(f).mcpStatus(), path.resolve('dist/main/main.js'));
  expect(status).toEqual([
    { name: 'echo', status: 'connected' },
    { name: 'broken', status: 'failed' },
  ]); // the approval server is not listed
  expect(log()).toMatch(/ mcp broken failed: /);
  expect(log()).not.toContain('echo failed');
  expect(log()).not.toContain(SECRET);
});

test('a failed server is logged once, not on every message', async () => {
  await send('hello');
  await send('hello again');
  expect(log().match(/ mcp broken failed/g)).toHaveLength(1);
});

test('turning a server off leaves it out of the next message, with no restart, and its tools get the turned-off message', async () => {
  setConnectors({ echo: { enabled: false } });
  await started();
  expect(runServers()).toEqual(['broken', 'claudepet']);
  await send('/deny mcp__echo__echo');
  await expect(lastReply()).toContainText('The "echo" server is off or not in mcp.json. Turn it on in Tools and connectors.');
});

test('with every server off, nothing that could ask is left, so no run config is passed', async () => {
  setConnectors({ echo: { enabled: false }, broken: { enabled: false } });
  const args = await started();
  expect(args).not.toContain('--mcp-config');
  setConnectors({}); // and back on
  await started();
  expect(runServers()).toEqual(['echo', 'broken', 'claudepet']);
});
