# CC Watcher

A live, animated dashboard for **Claude Code**. While Claude Code works in your projects, CC Watcher shows what it's doing right now (reading files, editing, running commands), with Clawd the mascot reacting to every step: working, idle, done, errors, streaks, combos, easter eggs, and falling asleep when things go quiet.

It runs on your own computer and only **reads** Claude Code's log files. Nothing is uploaded anywhere.

Website and live demo: **https://soul3286.github.io/cc-watcher/**

> A free, non-commercial fan project. Not affiliated with Anthropic. See [Credits](#credits).

## Start it

**Windows:** unzip the folder anywhere and double-click **`start.bat`**.

**Mac / Linux:** unzip, open a terminal in the folder and run **`sh start.sh`**.

The first time, it installs what it needs: Node.js if it's missing (winget on Windows, Homebrew on Mac), then two small libraries. After that it opens **http://localhost:4790** in your browser. Keep the black window open while you use it. Closing it stops the watcher.

Then use Claude Code as normal. Each session appears on the dashboard by itself.

Step-by-step help, including phone and desktop setup: [SETUP-GUIDE.md](SETUP-GUIDE.md).

## Demo mode

No Claude Code session running? The dashboard shows a **demo** with made-up projects, so you can see everything it does. You'll always know it's a demo: a striped **DEMO** badge sits in the corner, the panels have a dashed outline, and the status says "demo".

- **Switch to live** (on the badge) goes back to your real sessions.
- **▶ Demo** (top bar) starts the demo on purpose. Your choice is remembered.
- If real sessions start while the demo is playing, the badge tells you, but it never switches by itself.
- The demo keeps its own separate progress. It never touches your real stats, streaks or badges.

## On your phone

The dashboard works on phones and can be added to the home screen like an app.

- **iPhone (Safari):** open the address → Share → **Add to Home Screen**.
- **Android (Chrome):** open the address → ⋮ menu → **Install app** (or Add to Home screen).

Which address? Your phone has to reach the computer that runs CC Watcher:

- **Same Wi-Fi:** `http://<your computer's local IP>:4790` (on Windows, `ipconfig` shows it; allow Node.js through the firewall if asked). Some phone features, like installing as a full app on Android, need the HTTPS option below.
- **Anywhere, with HTTPS (optional, via Tailscale):** install [Tailscale](https://tailscale.com) on the computer and the phone, signed in to the same account. With CC Watcher running, run `tailscale serve --bg 4790` on the computer. It prints an address like `https://your-pc.your-tailnet.ts.net`. Only your own devices can open it. To stop sharing: `tailscale serve --https=443 off`.

If the phone can't reach the computer (it's asleep, the watcher isn't running, Tailscale is off), the page says so in a red banner and never pretends to be live.

## Desktop mascot (Windows only)

A separate download, **CC.Live.Setup.1.0.0.exe**, puts Clawd on your desktop as a small floating mascot showing the most important thing across all your sessions. Double-click him for the full dashboard; minimize or close the dashboard and he's back on your desktop. It includes its own copy of the watcher, so it works without this folder.

The installer isn't code-signed, so Windows SmartScreen asks once: **More info → Run anyway**.

- Drag Clawd to move him · click for toys & games · double-click for the dashboard.
- **Ctrl+Alt+D** opens the dashboard, **Ctrl+Alt+M** hides or shows Clawd. The tray icon has the rest.
- It stays above normal windows, but not above true fullscreen apps or games.

## Good to know

- **Where it reads from:** `~/.claude/projects/` (on Windows `%USERPROFILE%\.claude\projects\`), which holds Claude Code's own session logs. Read only.
- **Progress** (totals, records, badges, nicknames) is saved in your browser and in `progress.json` next to `server.js`, so your computer and phone share one record. Reset it from the 🏆 button.
- **Replay** (⏮) plays back a past session from Claude Code's logs (they're kept for about 30 days). Nothing extra is stored.
- **Sleep timer:** Clawd falls asleep after 30 minutes of quiet. To change it, run this in the browser console: `localStorage.setItem('ccw.sleepAfterMin', '60')` (minutes, `0` = never).
- **Different port:** set `PORT` before starting, for example `set PORT=4800` then `start.bat`.
- How it all fits together, in plain words: [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Use your own art

All mascot pictures are in `public/sprites/`, and `public/sprites.js` says which picture is used for which pose. Drop in your own files and change the names there. Nothing else refers to the files.

## Credits

- **Clawd**, **Claude** and **Claude Code** are characters and trademarks of **Anthropic**. All rights to the mascot and its artwork belong to Anthropic and the original creators.
- **None of the sprites were drawn by this project's author.** They were collected from the sources below, then resized, cropped or recoloured to fit the dashboard:
  - **[Tenor: "Claw'd crab laptop"](https://tenor.com/view/claude-claude-code-claw'd-crab-laptop-gif-14833619646318452398)**: working pose (laptop) and the still idle frames
  - **[Tenor: "Claw'd crab football"](https://tenor.com/view/claude-claude-code-claw'd-crab-football-gif-17523955505938523920)**: soccer idle pose
  - **Tenor: Claude Code sparkler GIF**: party easter egg
  - **[@claudeai on X](https://x.com/claudeai/status/2019833113418035237)**, via [ayotomcs.me/claude-mascot](https://ayotomcs.me/claude-mascot): flag-waving "done" pose, cut from Anthropic's official clip
  - **[rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)** (AGPL-3.0): headphones, error, waiting, sleeping and yawn poses; juggling, happy and double-jump eggs; Santa, pumpkin and party hats
  - **[marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank)** (MIT, © 2026 Marcio Granzotto Rodrigues): wizard, dizzy and overheated eggs
- The code was written by **Claude Opus 5.5**, Anthropic's AI model, working in Claude Code. Thank you, Opus.
- This is a **free, non-commercial fan project**, not affiliated with, endorsed by or sponsored by Anthropic.
- If you made any of this art and want it credited differently or removed, please open an issue: **https://github.com/soul3286/cc-watcher/issues**

The same text is in the app under **ⓘ Credits**.

## Licence

The code is MIT-licensed. The licence does **not** cover the mascot artwork. See [LICENSE](LICENSE).

## For developers

```
npm install        # everything, including the desktop app tools
npm start          # run the watcher
npm test           # unit tests
npm run desktop    # try the desktop mascot without installing
npm run dist       # build the Windows installer into dist/
npm run release    # build the shareable folder + zip into release/ (runs the privacy scan)
```
