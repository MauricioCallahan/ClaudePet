import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The pet window rides on top of the box: it follows it, hides with it, and toggles it when clicked.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let profile: string;

async function launch(settings?: object): Promise<void> {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  if (settings) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, CLAUDEPET_BRIDGE: 'fake' } });
  page = await app.firstWindow();
  await expect(page.locator('#messages .msg.claude').last()).toHaveText(/ClaudePet/);
}
async function quit(): Promise<void> {
  await app.close(); // hangs, and fails the test, if a pet window kept the app alive
  fs.rmSync(profile, { recursive: true, force: true });
}

const windows = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const find = (file: string) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(file));
    const box = find('index.html')!;
    const pet = find('pet.html');
    return {
      box: box.getBounds(),
      boxVisible: box.isVisible(),
      pet: pet?.getBounds(),
      petVisible: !!pet?.isVisible(),
      area: screen.getDisplayMatching(box.getBounds()).workArea,
      count: BrowserWindow.getAllWindows().length,
    };
  });
const moveBox = (x: number, y: number) =>
  app.evaluate(({ BrowserWindow }, [x, y]) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))!.setPosition(x, y), [x, y]);
// Where the pet should stand on a box that has room above it.
const onTop = (box: { x: number; y: number; width: number }) => ({ x: box.x + Math.round((box.width - 96) / 2), y: box.y - 104, width: 96, height: 104 });

test.describe('with the pet on', () => {
  test.beforeAll(() => launch());
  test.afterAll(quit);

  test('the pet opens centered on top of the box', async () => {
    await expect.poll(async () => (await windows()).petVisible).toBe(true);
    const w = await windows();
    expect(w.pet).toEqual(onTop(w.box));
  });

  test('the pet follows the box when it moves', async () => {
    const { box } = await windows();
    await moveBox(box.x - 50, box.y + 20);
    await expect.poll(async () => (await windows()).pet).toEqual(onTop({ ...box, x: box.x - 50, y: box.y + 20 }));
  });

  test('a box dropped at the top of the screen moves down so the pet stays fully visible', async () => {
    const { box, area } = await windows();
    await moveBox(box.x, area.y);
    // Windows emits 'moved' only when a real drag ends, not after setPosition, so stand in for the drop.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))!.emit('moved'));
    await expect.poll(async () => (await windows()).box.y).toBe(area.y + 104);
    expect((await windows()).pet).toEqual(onTop({ ...box, y: area.y + 104 }));
  });

  test('the pet hides and shows with the box', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))!.hide());
    await expect.poll(async () => (await windows()).petVisible).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))!.show());
    await expect.poll(async () => (await windows()).petVisible).toBe(true);
  });

  test('clicking the pet hides the box, and the pet with it', async () => {
    const pet = app.windows().find((p) => p.url().endsWith('pet.html'))!;
    await pet.click('img');
    await expect.poll(async () => (await windows()).boxVisible).toBe(false);
    expect((await windows()).petVisible).toBe(false);
  });
});

test.describe('with the pet off in settings', () => {
  test.beforeAll(() => launch({ pet: { enabled: false } }));
  test.afterAll(quit);

  test('only the box opens', async () => {
    await page.waitForTimeout(1000); // the pet would be up by now: it opens right after the box loads
    expect((await windows()).count).toBe(1);
  });
});
