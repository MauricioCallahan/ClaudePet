import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tool activity with the fake claude CLI: "/tool" runs a slow web search, "/tool fail" one that fails.
test.describe.configure({ mode: 'serial' });

for (const compact of [false, true]) {
  test.describe(compact ? 'compact box' : 'full box', () => {
    let app: ElectronApplication;
    let page: Page;
    let profile: string;

    test.beforeAll(async () => {
      profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
      fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ ui: { compact } }));
      const env = { ...process.env, CLAUDEPET_CLAUDE: path.join(__dirname, 'fixtures', 'fake-claude.cmd') };
      delete (env as NodeJS.ProcessEnv).CLAUDEPET_BRIDGE;
      app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env });
      page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      if (compact) await expect.poll(() => page.evaluate(() => document.body.dataset.mode)).toBe('collapsed');
      else await expect(page.locator('#messages .msg.claude').last()).toHaveText(/ClaudePet/);
    });
    test.afterAll(async () => {
      await app?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    });

    // Sprite rows (see STATE_ROW): 0 idle, 7 thinking, 1 working, 3 replied.
    const row = () => app.windows().find((p) => p.url().endsWith('pet.html'))?.evaluate(() => document.getElementById('pet')!.dataset.row);
    const reply = () => page.locator('#messages .msg.claude').last();
    const ask = async (text: string) => {
      if (compact && (await page.evaluate(() => document.body.dataset.mode)) !== 'chat') await page.click('#new-chat');
      await page.fill('#input', text);
      await page.press('#input', 'Enter');
    };
    const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });

    test('a search shows a running line, then a done line above the answer, while the pet works', async () => {
      await ask('/tool');
      await expect.poll(row).toBe('7');
      await expect(reply().locator('.tool.running')).toHaveText('Searching the web for "weather in Austin"…');
      await expect.poll(row).toBe('1');
      await expect(reply().locator('.tool.done')).toHaveText('✓ Searched the web for "weather in Austin"');
      await expect.poll(row).toBe('7');
      await expect.poll(row).toBe('3');
      await idle();
      await expect(reply().locator('> *').first()).toHaveClass('tool done'); // the line sits where the tool ran: before the text
      await expect(reply().locator('.part')).toHaveText('Sunny, 72°F.');
    });

    test('a failed search shows the failed line', async () => {
      await ask('/tool fail');
      await expect(reply().locator('.tool.failed')).toHaveText('✕ Web search failed', { timeout: 10_000 });
      await idle();
    });

    test('reopening the chat shows the lines again', async () => {
      const [latest] = await page.evaluate(() => (window as unknown as { pet: { listChats(): Promise<{ id: string }[]> } }).pet.listChats());
      await page.evaluate(() => document.getElementById('messages')!.replaceChildren()); // so the reopen visibly redraws it
      await page.evaluate((id) => (window as unknown as { pet: { openChat(id: string): void } }).pet.openChat(id), latest.id);
      await expect(page.locator('#messages .tool.done')).toHaveText('✓ Searched the web for "weather in Austin"');
      await expect(page.locator('#messages .tool.failed')).toHaveText('✕ Web search failed');
      await expect(page.locator('#messages .tool.running')).toHaveCount(0);
    });
  });
}
