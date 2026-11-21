import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Compact mode (the default): the box opens as the small pet bar, morphs into the new chat input, and grows into the
// chat. Reduced motion is on, so states switch at once. Clicks passing through the transparent parts need real mouse
// input and stay a by-hand check.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;

async function launch(settings?: object): Promise<void> {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  if (settings) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, CLAUDEPET_BRIDGE: 'fake' } });
  page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => windows().then((w) => w.boxVisible)).toBe(true);
}
async function quit(): Promise<void> {
  await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

const windows = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const find = (file: string) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(file));
    const box = find('index.html')!;
    return { box: box.getBounds(), boxVisible: box.isVisible(), focused: box.isFocused(), pet: find('pet.html')?.getBounds(), area: screen.getDisplayMatching(box.getBounds()).workArea };
  });
const boxEvent = (name: 'blur' | 'hide' | 'show') =>
  app.evaluate(({ BrowserWindow }, name) => {
    const box = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))!;
    if (name === 'blur') box.emit('blur'); // what a click outside the box does; real focus changes are flaky in CI
    else box[name]();
  }, name);
const main = (fn: string) => app.evaluate(({}, [f, fn]) => process.mainModule!.require(f)[fn](), [path.resolve('dist/main/main.js'), fn]);
const mode = () => page.evaluate(() => document.body.dataset.mode);
const send = async (text: string) => {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await expect(page.locator('#send')).toHaveText('Send', { timeout: 30_000 }); // the reply has ended
};
// The input bar's spot on screen: the window's bottom-center (the bar sits a fixed margin above it).
const spot = (b: { x: number; y: number; width: number; height: number }) => ({ cx: b.x + b.width / 2, bottom: b.y + b.height });
// Windows rounds window bounds at 125%, 150%... scaling, so allow a pixel (as pet.spec does).
const PX_TOLERANCE = 1;
const offBy = (a: Record<string, number>, b: Record<string, number>) => Math.max(...Object.keys(b).map((k) => Math.abs(a[k] - b[k])));

test.describe('the three states', () => {
  test.beforeAll(() => launch());
  test.afterAll(quit);
  let bar: { cx: number; bottom: number }; // where the collapsed bar first opened

  test('opens collapsed: only the pet and the small pill', async () => {
    expect(await mode()).toBe('collapsed');
    const w = await windows();
    expect(w.box).toMatchObject({ width: 384, height: 76 });
    bar = spot(w.box);
    await expect(page.locator('#new-chat')).toBeVisible();
    await expect(page.locator('#view-chats')).toBeVisible();
    for (const hidden of ['header', '#messages', '#chats', '#input', '#send']) await expect(page.locator(hidden)).toBeHidden();
    expect(await page.locator('#bar').evaluate((e) => e.getBoundingClientRect().width)).toBe(120);
    expect(await page.locator('#messages .msg').count()).toBe(0); // no greeting bubble in the compact box
  });

  test('New chat turns the pill into the focused input without resizing the window, and Esc turns it back', async () => {
    const before = (await windows()).box;
    await page.click('#new-chat');
    expect(await mode()).toBe('compose');
    await expect(page.locator('#input')).toBeFocused();
    await expect(page.locator('#input')).toHaveAttribute('placeholder', 'Start new chat');
    expect(await page.locator('#bar').evaluate((e) => e.getBoundingClientRect().width)).toBe(360);
    expect((await windows()).box).toEqual(before); // the morph is CSS only
    await page.keyboard.press('Escape');
    expect(await mode()).toBe('collapsed');
    expect((await windows()).box).toEqual(before);
  });

  test('the hotkey on the collapsed bar opens the new chat input', async () => {
    if (!(await windows()).focused) await main('onHotkey'); // the first press only brings the box forward
    await main('onHotkey');
    await expect.poll(mode).toBe('compose');
    await page.keyboard.press('Escape');
    expect(await mode()).toBe('collapsed');
  });

  test('sending starts the chat and the window grows upward from the same bottom edge', async () => {
    await page.click('#new-chat');
    await send('hi');
    expect(await mode()).toBe('chat');
    await expect(page.locator('#messages .msg')).toHaveCount(2);
    await expect(page.locator('#input')).toHaveAttribute('placeholder', 'Reply…');
    await expect.poll(async () => (await windows()).box.height).toBeGreaterThan(76);
    const w = await windows();
    expect(w.box.height).toBeLessThan(504);
    expect(offBy(spot(w.box), bar)).toBeLessThanOrEqual(PX_TOLERANCE);
  });

  test('a long reply stops growing at the full box height and scrolls', async () => {
    await send('/long');
    await expect.poll(async () => (await windows()).box.height).toBe(504);
    expect(offBy(spot((await windows()).box), bar)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(await page.locator('#messages').evaluate((m) => m.scrollHeight > m.clientHeight)).toBe(true);
  });

  test('Esc collapses back to the bar at the same spot, keeping the chat', async () => {
    await page.keyboard.press('Escape');
    await expect.poll(mode).toBe('collapsed');
    const w = await windows();
    expect(w.box).toMatchObject({ width: 384, height: 76 });
    expect(offBy(spot(w.box), bar)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(await page.locator('#messages .msg').count()).toBe(4);
  });

  test('hiding and showing reopens collapsed, with the chat kept', async () => {
    await page.click('#view-chats');
    expect(await mode()).toBe('chat');
    await main('toggleWindow');
    await main('toggleWindow');
    await expect.poll(mode).toBe('collapsed');
    expect((await windows()).box).toMatchObject({ width: 384, height: 76 });
    expect(await page.locator('#messages .msg').count()).toBe(4);
  });

  test('View chats on the pill opens the loaded chat', async () => {
    await page.click('#view-chats');
    expect(await mode()).toBe('chat');
    await expect(page.locator('#messages .msg')).toHaveCount(4);
    await expect.poll(async () => (await windows()).box.height).toBe(504);
  });

  test('a click outside the box collapses it, from chat and from the new chat input, and keeps unsent text', async () => {
    await page.fill('#input', 'half a thought');
    await boxEvent('blur');
    await expect.poll(mode).toBe('collapsed');
    expect(offBy(spot((await windows()).box), bar)).toBeLessThanOrEqual(PX_TOLERANCE);
    await page.click('#new-chat');
    await expect(page.locator('#input')).toHaveValue('half a thought');
    await boxEvent('blur');
    await expect.poll(mode).toBe('collapsed');
    await page.click('#new-chat');
    await page.fill('#input', '');
    await page.keyboard.press('Escape');
  });

  test('reopening a chat from Recent chats lands straight in the conversation', async () => {
    const [latest] = await page.evaluate(() => (window as unknown as { pet: { listChats(): Promise<{ id: string }[]> } }).pet.listChats());
    await page.evaluate(() => document.getElementById('messages')!.replaceChildren()); // so the reopen visibly redraws it
    await page.evaluate((id) => (window as unknown as { pet: { openChat(id: string): void } }).pet.openChat(id), latest.id); // the tray's path: main's openChat
    await expect.poll(mode).toBe('chat');
    await expect(page.locator('#messages .msg')).toHaveCount(4);
    await expect.poll(async () => (await windows()).box.height).toBe(504);
  });

  test("the tray's New chat opens the new chat input", async () => {
    await page.keyboard.press('Escape');
    await expect.poll(mode).toBe('collapsed');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))!.webContents.send('chat:new'));
    await expect.poll(mode).toBe('compose');
    await expect(page.locator('#messages .msg')).toHaveCount(0);
  });
});

// The full box at its highest allowed saved spot: expanding has no room above, so it grows downward instead.
test.describe('near the top of the screen', () => {
  test.beforeAll(async () => {
    await launch(); // only to learn the work area
    const { area } = await windows();
    await quit();
    await launch({ x: area.x + 100, y: area.y - 20 }); // the full box's top-left, as saved settings store it
  });
  test.afterAll(quit);

  test('the pet stays fully visible in every state, and collapsing returns the bar to its spot', async () => {
    const start = await windows();
    const bar = spot(start.box);
    await page.click('#new-chat');
    await send('/long');
    await expect.poll(async () => (await windows()).box.height).toBe(504);
    const w = await windows();
    expect(w.pet!.y).toBeGreaterThanOrEqual(w.area.y);
    expect(w.box.y).toBeGreaterThanOrEqual(w.area.y + 104 - PX_TOLERANCE); // pushed down so the pet fits above it
    await page.keyboard.press('Escape');
    await expect.poll(mode).toBe('collapsed');
    expect(offBy(spot((await windows()).box), bar)).toBeLessThanOrEqual(PX_TOLERANCE);
  });
});
