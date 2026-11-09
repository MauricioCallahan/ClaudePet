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


## Known issues
- ClaudePet claims **Ctrl+,** while it runs, so apps that use it for their own Settings (for example VS Code) lose that shortcut. To use another key, set `"hotkey"` (an [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator), e.g. `"Alt+Space"`) in `%APPDATA%\ClaudePet\settings.json` and restart. A settings panel will replace this in v0.2.

## License

[MIT](LICENSE) © 2026 Mauricio Callahan

ClaudePet is an independent project and is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic. Use of Claude through ClaudePet is subject to Anthropic's terms.