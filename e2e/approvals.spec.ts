import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Approvals with the fake claude CLI: "/approve WebFetch [Bash]" calls those tools at once and asks through
// ClaudePet's approval server, the way claude does. WebFetch has an ask rule so the server is passed.
test.describe.configure({ mode: 'serial' });

for (const compact of [false, true]) {
  test.describe(compact ? 'compact box' : 'full box', () => {
    let app: ElectronApplication;
    let page: Page;
    let profile: string;

    test.beforeAll(async () => {
      profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
      fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ ui: { compact }, tools: { approval: { WebFetch: 'ask' } } }));
      const env = { ...process.env, CLAUDEPET_CLAUDE: path.join(__dirname, 'fixtures', 'fake-claude.cmd') };
      delete (env as NodeJS.ProcessEnv).CLAUDEPET_BRIDGE;
      delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE; // set when run from inside VS Code; the app itself must start as Electron
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

    const card = () => page.locator('#approval');
    const reply = () => page.locator('#messages .msg.claude').last();
    const idle = () => expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 });
    const ask = async (text: string) => {
      if (compact && (await page.evaluate(() => document.body.dataset.mode)) !== 'chat') await page.click('#new-chat');
      await page.fill('#input', text);
      await page.press('#input', 'Enter');
    };

    test('a request shows the card with the cursor on Allow once, and Enter allows it', async () => {
      await ask('/approve WebFetch');
      await expect(card()).toBeVisible();
      await expect(page.locator('#approval-title')).toHaveText('Claude wants to read example.com');
      await expect(card().locator('[data-answer="once"]')).toBeFocused();
      await expect(page.locator('#approval-input')).toBeHidden();
      await page.click('#approval-details');
      await expect(page.locator('#approval-input')).toContainText('"url": "https://example.com"');
      await card().locator('[data-answer="once"]').focus();
      await page.keyboard.press('Enter');
      await expect(card()).toBeHidden();
      await expect(reply().locator('.part')).toHaveText('WebFetch: ran');
      await idle();
    });

    test('Deny reaches Claude as the tool error and the reply carries on, with no error', async () => {
      await ask('/approve WebFetch');
      await card().locator('[data-answer="deny"]').click();
      await expect(card()).toBeHidden();
      await expect(reply().locator('.part')).toHaveText('WebFetch: denied (The user denied this tool call.)');
      await expect(reply().locator('.tool.failed')).toHaveCount(1);
      await idle();
      await expect(page.locator('#messages .msg.claude', { hasText: 'tools are off' })).toHaveCount(0);
    });

    test('Esc on the card denies', async () => {
      await ask('/approve WebFetch');
      await expect(card().locator('[data-answer="once"]')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(reply().locator('.part')).toHaveText(/denied/);
      await idle();
      if (compact) expect(await page.evaluate(() => document.body.dataset.mode)).toBe('chat'); // Esc did not also collapse
    });

    // The two calls reach ClaudePet in either order, so the test follows whichever card comes first.
    test('two requests at once show one after the other', async () => {
      await ask('/approve WebFetch Bash');
      const titles = ['Claude wants to read example.com', 'Claude wants to use Bash'];
      await expect(page.locator('#approval-count')).toHaveText('1 of 2');
      const first = (await page.locator('#approval-title').textContent())!;
      expect(titles).toContain(first);
      await card().locator('[data-answer="once"]').click();
      await expect(page.locator('#approval-count')).toHaveText('2 of 2');
      await expect(page.locator('#approval-title')).toHaveText(titles.find((t) => t !== first)!);
      await expect(card().locator('[data-answer="once"]')).toBeFocused(); // a new card takes the cursor again
      await card().locator('[data-answer="once"]').click();
      await expect(card()).toBeHidden();
      await expect(reply().locator('.part')).toHaveText('WebFetch: ran; Bash: ran');
      await idle();
    });
  });
}
