# ClaudePet
A small desktop companion for Windows that lets you chat with Claude from anywhere, without opening the Claude app or a browser.

**How it works**

You ──▶ ClaudePet (Electron) ──▶ Claude Code (headless) ──▶ Claude

ClaudePet is a front end Pet for Claude Code. 

It runs Claude runs in the background, signing in with your existing Claude Pro or Max plan, so you don’t need an API key. Chats started in ClaudePet are saved on your PC and do not appear in claude.ai.

# Requirements
- Windows 10 or 11
- Node.js 20 or later
- Claude Code installed and signed in


## Pet format

ClaudePet pets use the same package format as Codex Pets, so a Codex pet folder or zip (for example Crosspost Buddy) works as is.

### Layout

A pet is one folder, named after its `id`:

```
pets/
  <id>/
    pet.json
    spritesheet.webp
```

Built-in pets live in `assets/pets/`, installed pets in `%APPDATA%\ClaudePet\pets\`.

### pet.json

```json
{
  "id": "crosspost-buddy",
  "displayName": "Crosspost Buddy",
  "description": "A cool little robot mascot with sunglasses.",
  "spritesheetPath": "spritesheet.webp"
}
```

| Field | Required | Rule |
|---|---|---|
| `id` | yes | 1-64 characters: lowercase letters, digits and dashes, starting with a letter or digit. It is also the folder name. |
| `displayName` | yes | Non-empty text shown in the pet picker. |
| `description` | no | Text; empty if missing. |
| `spritesheetPath` | yes | Path to the sprite sheet, relative to the pet folder, ending in `.png` or `.webp`. It may not be absolute or contain a `..` segment, so it always stays inside the folder. |

Any other field is ignored. Codex pets add `"spriteVersionNumber": 2` and `"kind": "object"`; ClaudePet reads neither (the sheet's size tells the version).

### Sprite sheet

One transparent PNG or WebP file, at most 20 MiB. It is a grid of 192x208-pixel cells, 8 columns wide (1536 px), with one row per state. Each row's frames start in the leftmost cell; cells after a row's last frame are fully transparent.

- Codex v1 sheets have 9 rows: 1536x1872.
- Codex v2 sheets have 11 rows: 1536x2288.
- ClaudePet also accepts fewer rows (any height that is a whole number of 208-px rows, 1 to 11). A missing row is a missing state, and the pet shows idle instead.

Rows, top to bottom, with Codex's frame counts and per-frame timings:

| Row | State | Frames | Frame durations (ms) | Plays | Used by ClaudePet for |
|---:|---|---:|---|---|---|
| 0 | idle | 6 | 280, 110, 110, 140, 140, 320 | loop | idle |
| 1 | running-right | 8 | 120 each, last 220 | loop | |
| 2 | running-left | 8 | 120 each, last 220 | loop | |
| 3 | waving | 4 | 140 each, last 280 | once | replied |
| 4 | jumping | 5 | 140 each, last 280 | once | |
| 5 | failed | 8 | 140 each, last 240 | once | error |
| 6 | waiting | 6 | 150 each, last 260 | loop | |
| 7 | running | 6 | 120 each, last 220 | loop | thinking |
| 8 | review | 6 | 150 each, last 280 | loop | |
| 9 | look directions, 0-157.5° | 8 | still poses | | |
| 10 | look directions, 180-337.5° | 8 | still poses | | |

Rows 9 and 10 exist only in v2 sheets: sixteen still poses looking clockwise from up, used by Codex to follow the pointer. "running" (row 7) means working or thinking, not literal running. The first idle frame (the top-left cell) is the pet's still picture, used for previews and when reduced motion is on.

## Known issues
- ClaudePet claims **Ctrl+,** while it runs, so apps that use it for their own Settings (for example VS Code) lose that shortcut. To use another key, set `"hotkey"` (an [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator), e.g. `"Alt+Space"`) in `%APPDATA%\ClaudePet\settings.json` and restart. A settings panel will replace this in v0.2.

## License

[MIT](LICENSE) © 2026 Mauricio Callahan

ClaudePet is an independent project and is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic. Use of Claude through ClaudePet is subject to Anthropic's terms.