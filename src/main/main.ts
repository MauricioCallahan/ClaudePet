import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { deleteMessages, isChatId, loadChats, appendMessage, loadMessages, matches, readMessages, recent, rename, saveChats, setSession, transcriptPath, upsert, type Chat, type SavedTool } from './chats';
import fs from 'node:fs';
import os from 'node:os';
import { FakeBridge, type Bridge } from './bridge';
import { ClaudeBridge, findClaude, readVersion } from './claudeBridge';
import { BridgeError, logLine, type ReplyError } from './errors';
import { anchorOnScreen, compactBounds, fitPosition, type Rect } from './bounds';
import { isWebUrl } from './links';
import { DEFAULT_PET_ID, loadSettings, petSettings, saveSettings, toolSettings, uiSettings } from './settings';
import { createPet, PET_SIZE, playRow, setPet, setPetEnabled } from './petWindow';
import { createMood, STATE_ROW } from './petState';
import { COLUMNS, sheetUrl, type Pet } from './petFormat';
import { initPicker, openPicker, pickerChanged, pickerWindow, type PickerItem } from './pickerWindow';
import { builtInPetsDir, ensurePetsDir, logPets, petsTmpDir, pickPet, scanPets, userPetsDir, type PetScan } from './pets';
import { installPet, readPetZip } from './petZip';
import { createTray, destroyTray, notify, refreshTray } from './tray';

let win: BrowserWindow | null = null;
let isQuitting = false;
const MAX_MESSAGE_LENGTH = 10_000;

// Compact mode (ui.compact): one transparent window with the bar drawn in CSS, and MARGIN of transparent room
// around it for the shadow (the top margin is also the gap under the pet). The renderer owns the mode, main the bounds.
const FULL = { width: 360, height: 480 }; // the full box; settings.x/y is its top-left in both modes
const MARGIN = 12;
const BAR_HEIGHT = 52; // the compose bar; the collapsed pill sits at the bottom of the same window
const COMPACT_WIDTH = FULL.width + 2 * MARGIN;
const MODES = ['collapsed', 'compose', 'chat'] as const;
type Mode = (typeof MODES)[number];
let compact = false; // read once at startup, like the hotkey
let mode: Mode = 'collapsed'; // from the renderer's last box:fit
let drawnHeight = BAR_HEIGHT; // chat mode: the box height the renderer asked for
let anchor = { cx: 0, bottom: 0 }; // the window's bottom-center; only a drag moves it, never a clamp
let boxRect: Rect | undefined; // the bounds last set, so a drag never reads back a drifted size
let firstFit = true; // the compact box shows once the renderer has drawn its first mode

// Sizes the compact window for the mode from the anchor. Always setBounds with the size:
// setPosition and the constructor let a transparent, non-resizable window drift a few pixels larger.
function fitBox(): void {
  if (!win) return;
  const height = (mode === 'chat' ? drawnHeight : BAR_HEIGHT) + 2 * MARGIN;
  const display = screen.getDisplayNearestPoint({ x: Math.round(anchor.cx), y: Math.round(anchor.bottom) });
  anchor = anchorOnScreen(anchor, COMPACT_WIDTH, display); // a monitor unplugged since the last drag
  boxRect = compactBounds(anchor, { width: COMPACT_WIDTH, height }, PET_SIZE.height, display.workArea);
  win.setBounds(boxRect);
}

// The box follows the cursor while the bar, the chat box or the pet is held; the renderers only say start/move/end.
let grab: { dx: number; dy: number } | null = null; // where on the window the pointer took hold
function dragBox(phase: unknown): void {
  if (!win || !boxRect) return;
  const c = screen.getCursorScreenPoint();
  if (phase === 'start') grab = { dx: c.x - boxRect.x, dy: c.y - boxRect.y };
  if (!grab || (phase !== 'move' && phase !== 'end')) return;
  boxRect = { ...boxRect, x: c.x - grab.dx, y: c.y - grab.dy };
  win.setBounds(boxRect);
  if (phase === 'end') {
    grab = null;
    anchor = { cx: boxRect.x + boxRect.width / 2, bottom: boxRect.y + boxRect.height };
    fitBox(); // dropped too high: moves down so the pet fits
    saveAnchor();
  }
}

// Stored as the full box's top-left, so turning compact mode off or on keeps the bar in the same place.
const saveAnchor = () => saveSettings({ x: Math.round(anchor.cx - FULL.width / 2), y: Math.round(anchor.bottom - MARGIN - FULL.height) });

function createWindow(): void {
  const settings = loadSettings();
  compact = uiSettings(settings).compact;
  const { x, y } = settings;
  const saved = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
  const pos = saved && fitPosition(saved, FULL, screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);
  const shape = compact
    ? { width: COMPACT_WIDTH, height: BAR_HEIGHT + 2 * MARGIN, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, show: false }
    : { ...pos, ...FULL, minWidth: 280, minHeight: 320 };
  win = new BrowserWindow({
    ...shape,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (compact) {
    const area = screen.getPrimaryDisplay().workArea;
    // The saved spot, not pos: a bar near the top puts the full box's header above the screen, and fitBox checks the bar itself.
    const full = saved ?? { x: area.x + (area.width - FULL.width) / 2, y: area.y + (area.height - FULL.height) / 2 }; // centered, like the full box
    anchor = { cx: full.x + FULL.width / 2, bottom: full.y + FULL.height + MARGIN };
    fitBox();
    win.setIgnoreMouseEvents(true, { forward: true }); // clicks pass through until the renderer reports the mouse over the bar
  }
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Links in replies open in the default browser, never inside the box.
  const openWeb = (url: string) => {
    if (isWebUrl(url)) void shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openWeb(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openWeb(url);
  });

  // Save the position once a drag settles, not on every pixel.
  const w = win;
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    if (compact) return saveAnchor();
    const [px, py] = w.getPosition();
    saveSettings({ x: px, y: py });
  };
  w.on('moved', () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  });
  w.on('close', (e) => {
    // × hides to the tray; only a real quit lets the window close.
    if (!isQuitting) {
      e.preventDefault();
      w.hide();
      return;
    }
    if (timer) {
      clearTimeout(timer);
      save();
    }
  });
  w.on('closed', () => (win = null));
  w.on('show', () => {
    refreshTray();
    mood.shown();
  });
  w.on('hide', refreshTray);
  if (!compact) return;
  // A click anywhere outside the box (it passes through the transparent margin) takes focus away: back to the bar.
  // The pet window can't take focus, so pressing the pet (to drag) leaves the box as it is.
  w.on('blur', () => {
    if (mode !== 'collapsed') w.webContents.send('box:collapse', false);
  });
  w.on('hide', () => w.webContents.send('box:collapse', true)); // so it always reopens as the bar, with no morph left to play
}

// focus() alone does nothing while the window is hidden in the tray, so show first.
function showWindow(): void {
  win?.show();
  win?.focus();
  win?.webContents.send('chat:focus');
}

function showAndSend(channel: string, ...args: unknown[]): void {
  if (!win) return;
  showWindow();
  win.webContents.send(channel, ...args);
}

let chats: Chat[] = [];

const workspace = path.join(app.getPath('userData'), 'workspace'); // the cwd of every claude process
const claudePath = () => findClaude(process.env, fs.existsSync, os.homedir());
const transcriptOf = (sessionId: string) => transcriptPath(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), workspace, sessionId);
// CLAUDEPET_BRIDGE=fake keeps the echo bridge for e2e tests and UI work without spending usage.
const bridge: Bridge =
  process.env.CLAUDEPET_BRIDGE === 'fake'
    ? new FakeBridge()
    : new ClaudeBridge({
        exe: claudePath,
        cwd: workspace,
        sessions: {
          get: (id) => chats.find((c) => c.id === id)?.sessionId,
          set: (id, sessionId) => {
            if (chats.find((c) => c.id === id)?.sessionId === sessionId) return; // every reply repeats it
            chats = setSession(chats, id, sessionId);
            saveChats(chats);
          },
        },
        transcript: transcriptOf,
        mode: (id) => chats.find((c) => c.id === id)?.mode ?? 'chat',
        model: () => loadSettings().model,
        tools: () => toolSettings(loadSettings()),
        instructions: () => {
          try {
            return fs.readFileSync(path.join(app.getPath('userData'), 'instructions.md'), 'utf8');
          } catch (err) {
            // No file means no custom instructions; any other error (locked, a folder) ends the reply with its message.
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw new Error(`Could not read your instructions.md: ${(err as Error).message}`);
          }
        },
        promptFile: path.join(app.getPath('userData'), 'system-prompt.md'),
        // Long, because Code mode (v0.3) runs tools that print nothing for minutes; e2e sets it short.
        idleMs: Number(process.env.CLAUDEPET_IDLE_MS) || 15 * 60_000,
      });
let inflight: AbortController | null = null;
let replyChat = ''; // the chat the running reply belongs to
let running: Promise<void> = Promise.resolve(); // the current runReply, so a reopen can wait for its save
const mood = createMood({ play: (s) => playRow(STATE_ROW[s]), visible: () => !!win?.isVisible() }); // what the pet shows about the reply

// shortcut: bridge.log grows without limit (errors only, so slowly); rotate it if it ever gets big
function logError(e: BridgeError): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'bridge.log'), logLine(new Date(), e.info.case, e.code, e.detail));
  } catch {
    // a log that cannot be written must never break the reply
  }
}

const MAX_TOOL_INPUT = 2000; // a saved tool keeps its input only up to this much JSON

// Streams one reply to the renderer as reply:start, reply:chunk... and reply:tool..., then reply:end or reply:error.
async function runReply(id: string, text: string): Promise<void> {
  const ac = new AbortController();
  inflight = ac;
  replyChat = id;
  refreshTray();
  const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args);
  send('reply:start');
  mood.event('send');
  let reply = '';
  const tools = new Map<string, SavedTool>(); // by tool id, in the order they started
  try {
    for await (const ev of bridge.send(id, text, ac.signal)) {
      if (typeof ev === 'string') {
        reply += ev;
        send('reply:chunk', ev);
        continue;
      }
      send('reply:tool', ev);
      if ('tool' in ev) {
        const { name, input } = ev.tool;
        const json = JSON.stringify(input) ?? '';
        // A tool that never finishes (Stop, an error) is saved as failed.
        const t = tools.get(ev.tool.id) ?? { name, at: reply.length, isError: true };
        tools.set(ev.tool.id, { ...t, name, input: json.length > MAX_TOOL_INPUT ? undefined : input });
      } else {
        const t = tools.get(ev.toolDone.id);
        if (t) t.isError = ev.toolDone.isError;
      }
    }
    send('reply:end');
    mood.event('end');
  } catch (err) {
    // Stop and New chat abort on purpose: that is an ordinary end, not an error.
    if (ac.signal.aborted) {
      send('reply:end');
      mood.event('stop');
    } else {
      const e = err instanceof BridgeError ? err : new BridgeError({ case: 'unknown', message: err instanceof Error ? err.message : String(err) });
      send('reply:error', e.info);
      mood.event('error');
      logError(e);
    }
  } finally {
    // Keep what streamed, even when Stop or an error cut it short; a chat deleted meanwhile stays deleted.
    if ((reply || tools.size) && chats.some((c) => c.id === id))
      appendMessage(id, { role: 'claude', text: reply, at: Date.now(), ...(tools.size ? { tools: [...tools.values()] } : {}) });
    inflight = null;
    refreshTray();
  }
}

// Shared by the tray's Recent chats and the chat list. Switching chats ends the running reply,
// and waits for it to be saved, so a reopened chat shows it and it cannot stream into the wrong chat.
async function openChat(id: string): Promise<void> {
  inflight?.abort();
  await running;
  mood.event('stop');
  showAndSend('chat:open', id);
}

let petScan: PetScan = { pets: [], skipped: [] };
let petSetting = { enabled: true, id: DEFAULT_PET_ID };
let shownPet: Pet | undefined;

// Shows pet.id, or the built-in pet with the reason in the log. Before the pet window exists this only picks.
function showChosenPet(): void {
  const { pet, reason } = pickPet(petScan, petSetting.id);
  if (reason) logPets(reason);
  shownPet = pet;
  setPet(pet);
}

// Tray → Pet → Refresh pets: picks up pets added or removed since startup.
export function refreshPets(): void {
  petScan = scanPets();
  showChosenPet();
  pickerChanged();
}

// saveSettings merges only the top level, so the whole pet object is saved each time.
function savePetSetting(patch: Partial<typeof petSetting>): void {
  petSetting = { ...petSetting, ...patch };
  saveSettings({ pet: petSetting });
}

// Tray → Pet → Hide pet.
export function togglePetHidden(): void {
  savePetSetting({ enabled: !petSetting.enabled });
  setPetEnabled(petSetting.enabled);
  refreshTray();
}

const pickerItems = (): PickerItem[] =>
  petScan.pets.map((p) => ({ id: p.manifest.id, displayName: p.manifest.displayName, url: sheetUrl(p), columns: COLUMNS, rows: p.rows, chosen: p === shownPet }));

// From the picker: only an id that is in the list (the picker's id is already checked to be a safe name).
function choosePetById(id: string): void {
  if (!petScan.pets.some((p) => p.manifest.id === id)) return;
  savePetSetting({ id });
  showChosenPet();
  pickerChanged();
}

let installing = false;

// Checks a pet zip, asks before replacing an installed pet, installs it, and shows it in the box and the picker.
// A bad zip changes nothing and is reported in a tray balloon and pets.log.
async function installPetFromZip(zipPath: string): Promise<void> {
  if (installing) return notify('Install in progress', 'Wait for the current pet install to finish.'); // one install at a time
  installing = true;
  try {
    const read = await readPetZip(zipPath);
    const { manifest } = read;
    const parent = pickerWindow();
    const replace = fs.existsSync(path.join(userPetsDir(), manifest.id));
    if (replace) {
      const ask = { type: 'question' as const, buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Install pet', message: 'Replace the existing pet?', detail: `"${manifest.displayName}" (${manifest.id}) is already installed.` };
      const { response } = await (parent ? dialog.showMessageBox(parent, ask) : dialog.showMessageBox(ask));
      if (response !== 0) return;
    }
    await installPet(zipPath, { petsDir: userPetsDir(), tmpRoot: petsTmpDir(), builtInDir: builtInPetsDir, replace, read });
    refreshPets();
    choosePetById(manifest.id);
    openPicker();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logPets(`Could not install ${zipPath}: ${reason}`);
    notify('Could not install the pet', reason);
  } finally {
    installing = false;
  }
}

// Picker button and tray item: choose a zip, then install it.
async function installPetDialog(): Promise<void> {
  const parent = pickerWindow();
  const opts = { title: 'Install pet from zip', properties: ['openFile' as const], filters: [{ name: 'Pet zip', extensions: ['zip', 'claudepet'] }] };
  const { canceled, filePaths } = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts));
  if (!canceled && filePaths[0]) await installPetFromZip(filePaths[0]);
}

// Removes the chat everywhere: the index, its messages, the tray, the box, and Claude Code's own transcript.
async function deleteChat(id: string): Promise<void> {
  // Only this chat's own reply is stopped and waited for (its save must not bring the messages back).
  if (inflight && replyChat === id) {
    inflight.abort();
    await running;
  }
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;
  chats = chats.filter((c) => c !== chat);
  saveChats(chats);
  refreshTray();
  win?.webContents.send('chat:deleted', id);
  // Each file on its own, so one that is locked (antivirus, backup) does not keep the others on disk.
  const remove = (what: string, rm: () => void) => {
    try {
      rm();
    } catch (err) {
      console.error(`Could not delete the ${what} of chat ${id}:`, err);
    }
  };
  remove('messages', () => deleteMessages(id));
  const transcript = chat.sessionId && transcriptOf(chat.sessionId);
  if (transcript) {
    remove('transcript', () => fs.rmSync(transcript, { force: true }));
    remove('session folder', () => fs.rmSync(transcript.slice(0, -'.jsonl'.length), { recursive: true, force: true })); // the session's side folder, if any
  }
}

// Shared by the tray and (Bullet 3) the global hotkey.
export function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

// The global hotkey. Visible but behind another app: bring it forward instead of hiding it.
// Pressed again on the focused, collapsed compact bar: open the new chat input.
export function onHotkey(): void {
  if (win?.isVisible() && !win.isFocused()) showWindow();
  else if (compact && win?.isVisible() && mode === 'collapsed') win.webContents.send('chat:compose');
  else toggleWindow();
}

const DEFAULT_HOTKEY = 'CommandOrControl+,';
let hotkey = '';

// Swap the global shortcut; the v0.2 settings panel only needs to call this and saveSettings.
export function registerHotkey(accel: string): boolean {
  if (accel === hotkey) return true;
  let ok = false;
  try {
    ok = globalShortcut.register(accel, onHotkey);
  } catch {
    // register() throws on a malformed accelerator in settings.json
  }
  if (ok) {
    // Only drop the old key once the new one works, so a failed change keeps the old hotkey.
    if (hotkey) globalShortcut.unregister(hotkey);
    hotkey = accel;
  } else {
    console.error(`Could not register ${accel}: invalid or used by another app`);
    notify('Hotkey unavailable', `${accel} is invalid or used by another app. Use the tray icon to open ClaudePet.`);
  }
  return ok;
}

// Only one pet at a time: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    const claude = claudePath();
    if (!claude) console.log('Claude Code: not installed');
    else void readVersion(claude).then((v) => console.log(`Claude Code: ${claude} (${v ?? 'unknown version'})`));
    chats = loadChats();
    // The renderer is untrusted input: check types and cap sizes before storing.
    ipcMain.on('chat:message', (_e, id: unknown, text: unknown, retry: unknown) => {
      if (!isChatId(id) || typeof text !== 'string') return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        // The renderer is already waiting on a reply; without this it would stay on Stop forever.
        const error: ReplyError = { case: 'unknown', message: `Message too long (max ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters).` };
        win?.webContents.send('reply:error', error);
        mood.event('error');
        return;
      }
      if (inflight) return; // one reply at a time; the renderer swaps Send for Stop
      const now = Date.now();
      chats = upsert(chats, id, text, now);
      saveChats(chats);
      if (retry !== true) appendMessage(id, { role: 'user', text, at: now }); // a Retry's message is already stored
      refreshTray();
      running = runReply(id, text);
    });
    ipcMain.on('clipboard:write', (_e, text: unknown) => {
      if (typeof text === 'string' && text.length <= 1_000_000) clipboard.writeText(text);
    });
    ipcMain.on('chat:stop', () => inflight?.abort());
    ipcMain.on('chat:open', (_e, id: unknown) => {
      if (isChatId(id)) void openChat(id);
    });
    ipcMain.on('chat:rename', (_e, id: unknown, title: unknown) => {
      if (!isChatId(id) || typeof title !== 'string') return;
      chats = rename(chats, id, title);
      saveChats(chats);
      refreshTray();
    });
    ipcMain.on('chat:delete', (_e, id: unknown) => {
      if (isChatId(id)) void deleteChat(id);
    });
    // Compact box: the renderer reports its mode and wanted height, and where the mouse is; main sizes and moves the window.
    ipcMain.handle('ui:compact', () => compact);
    const fromBox = (e: Electron.IpcMainEvent) => compact && !!win && e.sender === win.webContents;
    ipcMain.on('box:fit', (e, m: unknown, height: unknown) => {
      if (!fromBox(e) || !MODES.includes(m as Mode) || typeof height !== 'number' || !Number.isFinite(height)) return;
      mode = m as Mode;
      drawnHeight = Math.min(Math.max(Math.round(height), BAR_HEIGHT), FULL.height);
      fitBox();
      if (firstFit) {
        firstFit = false;
        win!.show();
      }
    });
    ipcMain.on('box:mouse', (e, inside: unknown) => {
      if (fromBox(e) && typeof inside === 'boolean') win!.setIgnoreMouseEvents(!inside, { forward: true });
    });
    // Dragged in JS, not with -webkit-app-region: Windows sends no mouse events over a drag region,
    // so the renderer could never tell main to stop ignoring clicks there.
    ipcMain.on('box:drag', (e, phase: unknown) => {
      if (fromBox(e)) dragBox(phase);
    });
    // Windows moves the box off a removed monitor by itself; refit at once so the anchor and boxRect follow,
    // or the next resize or drag would put it back where no screen is.
    screen.on('display-removed', () => compact && fitBox());
    ipcMain.handle('chat:load', (_e, id: unknown) => (isChatId(id) ? loadMessages(id) : []));
    ipcMain.handle('chats:list', async (_e, query: unknown) => {
      const q = typeof query === 'string' ? query.slice(0, 200) : '';
      const all = recent(chats, Infinity);
      // shortcut: reads every chat file on each search; keep messages in memory if the list gets slow
      const hits = q.trim() ? (await Promise.all(all.map(async (c) => matches(c, await readMessages(c.id), q)))).flatMap((ok, i) => (ok ? [all[i]] : [])) : all;
      return hits.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    });
    createWindow();
    // After the box has loaded, so it is always the first window (e2e's firstWindow relies on it).
    ensurePetsDir();
    petScan = scanPets();
    petSetting = petSettings(loadSettings());
    showChosenPet();
    win?.webContents.once('did-finish-load', () => win && createPet(win, shownPet, petSetting.enabled, (p) => void installPetFromZip(p), (phase) => compact && dragBox(phase)));
    initPicker({ list: pickerItems, choose: choosePetById, install: () => void installPetDialog(), drop: (p) => void installPetFromZip(p) });
    createTray({
      toggle: toggleWindow,
      isVisible: () => !!win?.isVisible(),
      isThinking: () => !!inflight,
      // Switching chats ends the running reply so it cannot stream into the wrong chat.
      // Waits for the reply to end, as openChat does: until then main would drop a message sent from the new chat.
      newChat: async () => {
        inflight?.abort();
        await running;
        mood.event('stop');
        showAndSend('chat:new');
      },
      recent: () => recent(chats),
      openChat: (id) => void openChat(id),
      choosePet: openPicker,
      installPet: () => void installPetDialog(),
      refreshPets,
      isPetHidden: () => !petSetting.enabled,
      togglePetHidden,
    });
    const { hotkey: saved } = loadSettings();
    registerHotkey(typeof saved === 'string' && saved ? saved : DEFAULT_HOTKEY);
  });
  // Covers every quit path (tray menu, Windows shutdown), not just our own menu item.
  app.on('before-quit', () => {
    isQuitting = true;
    inflight?.abort(); // kills a running claude process so none outlives the app
    destroyTray();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
