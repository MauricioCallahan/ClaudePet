import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';

// Installed pets: the pets folder, the built-in pet, ClaudePet's and Codex's folders, the picker, and the fallback.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let pet: Page;
// One profile and one fake Codex home for the whole file, so a relaunch sees what the last run saved.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-codex-')); // never the real ~/.codex
const fixture = (id: string) => path.join(__dirname, 'fixtures/pets', id);

async function launch(): Promise<void> {
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, CLAUDEPET_BRIDGE: 'fake', CODEX_HOME: codexHome } });
  await app.firstWindow();
  await expect.poll(() => app.windows().some((p) => p.url().endsWith('pet.html'))).toBe(true);
  pet = app.windows().find((p) => p.url().endsWith('pet.html'))!;
}
// Which pet folder the pet window draws, e.g. "pip".
const shownPet = () => pet.evaluate(() => getComputedStyle(document.getElementById('pet')!).backgroundImage.match(/pets\/([^/]+)\//)?.[1]);
// Main-process functions the tray menu calls.
const main = (file: string, fn: string) =>
  app.evaluate(({}, [f, name]) => process.mainModule!.require(f)[name](), [path.resolve('dist/main', file), fn]);
async function picker(): Promise<Page> {
  await main('pickerWindow.js', 'openPicker');
  await expect.poll(() => app.windows().some((p) => p.url().endsWith('picker.html'))).toBe(true);
  return app.windows().find((p) => p.url().endsWith('picker.html'))!;
}
const petsLog = () => fs.readFileSync(path.join(profile, 'pets.log'), 'utf8');
const listed = (p: Page) => p.$$eval('.pet', (bs) => bs.map((b) => (b as HTMLElement).dataset.id + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(codexHome, { recursive: true, force: true });
});

test('a fresh install has an empty pets folder and shows the built-in pet', async () => {
  await launch();
  expect(fs.readdirSync(path.join(profile, 'pets'))).toEqual([]);
  await expect.poll(shownPet).toBe('pip');
});

test('pets copied into the ClaudePet and Codex folders appear after Refresh pets', async () => {
  fs.cpSync(fixture('valid'), path.join(profile, 'pets', 'valid'), { recursive: true });
  fs.cpSync(fixture('extra-fields'), path.join(codexHome, 'pets', 'extra-fields'), { recursive: true });
  fs.cpSync(fixture('broken-json'), path.join(profile, 'pets', 'broken-json'), { recursive: true }); // skipped, not shown
  await main('main.js', 'refreshPets');
  const p = await picker();
  await expect.poll(() => listed(p)).toEqual(['pip*', 'valid', 'extra-fields']);
  expect(petsLog()).toMatch(/Pet folder .*broken-json skipped: pet.json is not valid JSON/);
});

test('choosing a pet in the picker swaps it at once and saves it', async () => {
  const p = await picker();
  await p.click('.pet[data-id="valid"]');
  await expect.poll(shownPet).toBe('valid');
  await expect.poll(() => listed(p)).toEqual(['pip', 'valid*', 'extra-fields']);
  expect(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).pet).toEqual({ enabled: true, id: 'valid' });
});

test('the chosen pet survives a restart', async () => {
  await app.close();
  await launch();
  await expect.poll(shownPet).toBe('valid');
});

test('Hide pet hides the pet at once, keeps it hidden through Show/Hide, and brings it back', async () => {
  const box = (action: 'hide' | 'show') =>
    app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))![a](), action);
  const petVisible = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('pet.html'))?.isVisible());
  const enabled = () => JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).pet.enabled;
  await expect.poll(petVisible).toBe(true);
  await main('main.js', 'togglePetHidden');
  await expect.poll(petVisible).toBe(false);
  expect(enabled()).toBe(false);
  await box('hide');
  await box('show');
  await pet.waitForTimeout(300);
  expect(await petVisible()).toBe(false);
  await main('main.js', 'togglePetHidden');
  await expect.poll(petVisible).toBe(true);
  expect(enabled()).toBe(true);
});

test('deleting the chosen pet and pressing Refresh falls back to the built-in pet', async () => {
  const p = await picker();
  fs.rmSync(path.join(profile, 'pets', 'valid'), { recursive: true });
  await main('main.js', 'refreshPets');
  await expect.poll(shownPet).toBe('pip');
  await expect.poll(() => listed(p)).toEqual(['pip*', 'extra-fields']);
  // The setting stays, so the pet comes back if its folder does.
  expect(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).pet.id).toBe('valid');
  expect(petsLog()).toContain('Pet "valid" is not installed; showing "pip" instead');
});

// Installing from a zip. The file and confirm dialogs are native, so main's are stubbed; the drop is sent as the pet page's own message.
async function zipFile(name: string, over: object = {}): Promise<string> {
  const z = new yazl.ZipFile();
  const meta = { ...JSON.parse(fs.readFileSync(path.join(fixture('valid'), 'pet.json'), 'utf8')), id: 'zipped', displayName: 'Zipped', ...over };
  z.addBuffer(Buffer.from(JSON.stringify(meta)), 'pet.json');
  z.addFile(path.join(fixture('valid'), 'spritesheet.png'), 'spritesheet.png');
  z.end();
  const chunks: Buffer[] = [];
  for await (const c of z.outputStream) chunks.push(c as Buffer);
  const file = path.join(profile, name);
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}
// `answer` is the button Replace? gets: 0 replaces, 1 cancels. `asked` counts how often it was asked.
const stubDialogs = (zip: string, answer = 0) =>
  app.evaluate(({ dialog }, [f, a]) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
    (globalThis as any).asked = 0;
    dialog.showMessageBox = (async () => ((globalThis as any).asked++, { response: a as number, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, [zip, answer] as const);
const names = (p: Page) => p.$$eval('.pet .name', (ns) => ns.map((n) => n.textContent));

test('Install pet from zip… in the picker installs the pet and shows it at once', async () => {
  const p = await picker();
  await stubDialogs(await zipFile('zipped.zip'));
  await p.click('#install');
  await expect.poll(shownPet).toBe('zipped');
  await expect.poll(() => listed(p)).toEqual(['pip', 'zipped*', 'extra-fields']);
  expect(fs.readdirSync(path.join(profile, 'pets', 'zipped')).sort()).toEqual(['pet.json', 'spritesheet.png']);
  expect(fs.readdirSync(path.join(profile, 'pets-tmp'))).toEqual([]);
});

test('installing the same pet again replaces it', async () => {
  const p = await picker();
  await stubDialogs(await zipFile('zipped2.zip', { displayName: 'Zipped again' }));
  await p.click('#install');
  await expect.poll(() => names(p)).toContain('Zipped again');
  expect(await names(p)).not.toContain('Zipped');
  await expect.poll(shownPet).toBe('zipped');
});

test('cancelling Replace? leaves the installed pet as it was', async () => {
  const p = await picker();
  await stubDialogs(await zipFile('cancelled.zip', { displayName: 'Cancelled' }), 1);
  await p.click('#install');
  await expect.poll(() => app.evaluate(() => (globalThis as any).asked)).toBe(1);
  expect(fs.readFileSync(path.join(profile, 'pets', 'zipped', 'pet.json'), 'utf8')).toContain('Zipped again');
  expect(await names(p)).not.toContain('Cancelled');
});

test('a zip dropped on the pet installs it, and a bad one is logged and changes nothing', async () => {
  const drop = (zip: string) =>
    app.evaluate(({ BrowserWindow, ipcMain }, f) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('pet.html'))!;
      ipcMain.emit('pet:drop', { sender: w.webContents }, f);
    }, zip);
  await drop(await zipFile('dropped.zip', { id: 'dropped', displayName: 'Dropped' }));
  await expect.poll(shownPet).toBe('dropped');
  const bad = path.join(profile, 'bad.zip');
  fs.writeFileSync(bad, 'not a zip');
  await drop(bad);
  await expect.poll(() => petsLog()).toMatch(/Could not install .*bad\.zip: not a readable zip/);
  expect(await shownPet()).toBe('dropped');
});
