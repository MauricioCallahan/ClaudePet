import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A pet package in the pets folder is checked and its sprite sheet plays in the pet window, row by row.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let pet: Page;
let profile: string;

// Codex's rows 0-8: frame durations (ms) and whether the row loops (see ROWS in petFormat.ts).
const ms = (n: number, each: number, last: number) => [...Array(n - 1).fill(each), last];
const ROWS = [
  { durations: [280, 110, 110, 140, 140, 320], loop: true },
  { durations: ms(8, 120, 220), loop: true },
  { durations: ms(8, 120, 220), loop: true },
  { durations: ms(4, 140, 280), loop: false },
  { durations: ms(5, 140, 280), loop: false },
  { durations: ms(8, 140, 240), loop: false },
  { durations: ms(6, 150, 260), loop: true },
  { durations: ms(6, 120, 220), loop: true },
  { durations: ms(6, 150, 280), loop: true },
];

async function launch(id: string): Promise<void> {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claudepet-e2e-'));
  fs.cpSync(path.join(__dirname, 'fixtures/pets', id), path.join(profile, 'pets', id), { recursive: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ pet: { id } }));
  app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, CLAUDEPET_BRIDGE: 'fake' } });
  await app.firstWindow();
  await expect.poll(() => app.windows().some((p) => p.url().endsWith('pet.html'))).toBe(true);
  pet = app.windows().find((p) => p.url().endsWith('pet.html'))!;
  await pet.waitForLoadState();
}
async function quit(): Promise<void> {
  await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

const playRow = (row: number) =>
  app.evaluate(({}, [file, row]) => process.mainModule!.require(file as string).playRow(row), [path.resolve('dist/main/petWindow.js'), row]);

// Records every frame change of the pet as [row, frame, ms since start], starting before the row is asked for.
async function record(row: number, ms: number): Promise<[number, number, number][]> {
  await playRow(row === 0 ? 1 : 0); // idle is already playing; another row first means every recorded frame of this row is from the fresh start
  await pet.evaluate(() => {
    const el = document.getElementById('pet')!;
    const t0 = performance.now();
    const seen: [number, number, number][] = [];
    (window as any).seen = seen;
    new MutationObserver(() => seen.push([+el.dataset.row!, +el.dataset.frame!, performance.now() - t0])).observe(el, { attributeFilter: ['data-frame'] });
  });
  await playRow(row);
  await pet.waitForTimeout(ms);
  return pet.evaluate(() => (window as any).seen);
}

test.describe('a valid pet', () => {
  test.beforeAll(() => launch('valid'));
  test.afterAll(quit);

  test('its sprite sheet replaces the placeholder', async () => {
    const size = await pet.evaluate(async () => {
      const url = getComputedStyle(document.getElementById('pet')!).backgroundImage.slice(5, -2);
      const img = new Image();
      img.src = url;
      await img.decode();
      return `${url.endsWith('/pets/valid/spritesheet.png')} ${img.naturalWidth}x${img.naturalHeight}`;
    });
    expect(size).toBe('true 1536x2288');
  });

  test('it starts on the idle row', async () => {
    await expect.poll(() => pet.evaluate(() => document.getElementById('pet')!.dataset.row)).toBe('0');
  });

  for (const [row, { durations, loop }] of ROWS.entries()) {
    test(`row ${row} plays its ${durations.length} frames ${loop ? 'in a loop' : 'once'} at Codex's speed`, async () => {
      const cycle = durations.reduce((a, b) => a + b, 0);
      const seen = (await record(row, cycle + 400)).filter(([r]) => r === row);
      const frames = seen.map(([, f]) => f);
      const all = [...durations.keys()];
      if (loop) expect(frames.slice(0, durations.length + 1)).toEqual([...all, 0]);
      else expect(frames).toEqual(all); // and it stays on the last frame
      // From the first frame to the last (or back to the first) takes as long as Codex's timings say, with room for a busy machine.
      const end = loop ? seen[durations.length][2] : seen[durations.length - 1][2];
      const want = loop ? cycle : cycle - durations[durations.length - 1];
      expect(end - seen[0][2]).toBeGreaterThanOrEqual(want - 20);
      expect(end - seen[0][2]).toBeLessThan(want * 1.5);
    });
  }

  test('a row the sheet has no animation for plays idle', async () => {
    const seen = await record(10, 300);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([r]) => r === 0)).toBe(true);
  });
});

for (const id of ['broken-json', 'wrong-size']) {
  test.describe(`a pet with a ${id.replace('-', ' ')}`, () => {
    test.beforeAll(() => launch(id));
    test.afterAll(quit);

    test('keeps the placeholder and the app keeps running', async () => {
      await pet.waitForTimeout(500); // a sheet would have arrived by now
      expect(await pet.evaluate(() => getComputedStyle(document.getElementById('pet')!).backgroundImage)).toContain('pet-placeholder.svg');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
    });
  });
}
