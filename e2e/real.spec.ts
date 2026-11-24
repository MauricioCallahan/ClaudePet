import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The app end to end with your installed, signed-in Claude Code: no fake bridge, no fake CLI. It spends real usage
// (about six one-line replies per model in REAL_MODELS, playwright.config.ts), so `npm run e2e` skips it; run it
// with `npm run e2e:real`, or one model with `npx playwright test --project=real-haiku`.
// Covers what the fake can't prove: replies stream from the real CLI, a follow-up and a reopened chat after a restart
// continue the same Claude conversation, Retry after going offline sends the prompt once, and Delete removes the
// real transcript.
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let app: ElectronApplication;
let page: Page;
let profile: string;
const lastReply = () => page.locator('#messages .msg.claude').last();
const rows = () => page.locator('#chat-list .title');
const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(profile, ...p), 'utf8'));
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'); // the real login lives here
// Claude Code's folder for the app's workspace, as transcriptPath in src/main/chats.ts names it.
const projectDir = () => path.join(configDir, 'projects', path.join(profile, 'workspace').replace(/[^a-zA-Z0-9]/g, '-'));
const transcript = () => path.join(projectDir(), `${readJson('chats.json')[0].sessionId}.jsonl`);
// Claude Code's transcript lines have no published type.
const lines = (file: string): any[] => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
// Every failed reply is logged; an empty log means each reply so far came back from Claude.
const errors = () => (fs.existsSync(path.join(profile, 'bridge.log')) ? fs.readFileSync(path.join(profile, 'bridge.log'), 'utf8') : '');

async function launch(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDEPET_BRIDGE;
  delete env.CLAUDEPET_CLAUDE;
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
  page = await app.firstWindow();
  await expect(lastReply()).toHaveText(/ClaudePet/);
}
async function send(text: string): Promise<void> {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await expect(page.locator('#send')).toHaveText('Stop'); // the reply is running
  await expect(page.locator('#send')).toHaveText('Send', { timeout: 120_000 }); // and has ended
}

let model: string; // from the Playwright project: one run per model in REAL_MODELS
test.beforeAll(async ({}, info) => {
  model = info.project.metadata.model;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-real-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ model, ui: { compact: false } }));
  await launch();
});
test.afterAll(async () => {
  await app?.close();
  fs.rmSync(projectDir(), { recursive: true, force: true }); // this run's sessions in Claude Code
  fs.rmSync(profile, { recursive: true, force: true });
});

test('a real reply streams in, and a follow-up continues the same conversation', async () => {
  await send('Remember the word pancake. Reply with only: ok');
  expect(errors()).toBe('');
  await expect(lastReply()).not.toBeEmpty();
  await send('What word did I ask you to remember? Reply with only that word.');
  expect(errors()).toBe('');
  await expect(lastReply()).toContainText(/pancake/i);
  expect(fs.existsSync(transcript())).toBe(true); // where Claude Code keeps it, as the app expects
  // The model from settings.json is the one that answered (ids look like claude-haiku-5-5).
  const used = lines(transcript()).flatMap((v) => (v.type === 'assistant' && typeof v.message?.model === 'string' ? [v.message.model] : []));
  expect(used.length).toBeGreaterThan(0);
  for (const id of used) expect(id).toContain(model);
});

test('after a restart, the reopened chat still continues the same conversation', async () => {
  await app.close();
  await launch();
  await page.click('#chats-button');
  await rows().first().click();
  await expect(page.locator('#messages .msg.user')).toHaveCount(2);
  await send('Say the word again. Reply with only that word.');
  expect(errors()).toBe('');
  await expect(lastReply()).toContainText(/pancake/i);
});

test('offline shows the network error, and Retry sends the prompt to Claude once', async () => {
  const prompt = 'Reply with only the word: waffle';
  // A proxy that refuses every connection, for the claude processes the app starts from now on.
  await app.evaluate(() => Object.assign(process.env, { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' }));
  await send(prompt);
  await expect(lastReply()).toContainText("Can't reach Claude.");
  expect(errors()).toMatch(/ network /);
  await app.evaluate(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  });
  await lastReply().locator('button.retry').click();
  await expect(page.locator('#send')).toHaveText('Send', { timeout: 120_000 });
  await expect(lastReply()).toContainText(/waffle/i);
  const turns = lines(transcript()).filter((v) => v.type === 'user' && JSON.stringify(v.message ?? '').includes(prompt));
  expect(turns).toHaveLength(1);
});

// A server from mcp.json, started by the real Claude Code, called after the approval card: the one path the fake can't prove.
test('a tool of an mcp.json server runs after Allow once, and the log holds no secret', async () => {
  const secret = 's3cr3t-value';
  fs.writeFileSync(path.join(profile, 'mcp.json'), JSON.stringify({ mcpServers: { echo: { command: 'node', args: [path.resolve('e2e/fixtures/echo-mcp.js')], env: { TOKEN: secret } } } }));
  await page.fill('#input', 'Call the echo tool from the echo server with the text kumquat, then reply with only the text it returned.');
  await page.press('#input', 'Enter');
  await expect(page.locator('#approval-title')).toHaveText('Claude wants to use Echo: echo', { timeout: 120_000 });
  await page.click('#approval [data-answer="once"]');
  await expect(page.locator('#send')).toHaveText('Send', { timeout: 120_000 });
  await expect(lastReply()).toContainText(/kumquat/i);
  expect(errors()).not.toContain(secret);
  expect(errors()).not.toMatch(/ mcp /); // the server connected, so nothing about it was logged
  fs.rmSync(path.join(profile, 'mcp.json'));
});

test('Delete removes the chat and its real Claude Code transcript', async () => {
  const file = transcript();
  await page.click('#chats-button');
  await page.locator('#chat-list li').first().locator('button.delete').click();
  await page.click('#chat-list button.yes');
  await expect(rows()).toHaveCount(0);
  expect(fs.existsSync(file)).toBe(false);
});
