# How CC Watcher works

A short tour in plain words.

## The big picture

```
Claude Code ──writes──▶ its log files ──read by──▶ the watcher ──live updates──▶ your browser / phone / desktop mascot
```

1. **Claude Code keeps a diary.** Every time it reads a file, edits one or runs a command, it writes a line into a log file on your computer (`~/.claude/projects/`).
2. **The watcher reads the diary.** `server.js` is a small program that watches those log files. When a new line appears, it turns it into a short message like "editing garden.ts" or "command failed". It never changes the logs.
3. **The dashboard shows it.** The watcher sends each message straight to any open dashboard (browser, phone or desktop mascot) over a live connection. The page decides how Clawd reacts: working, idle, done, error, and so on.

Everything stays on your computer. The watcher only answers devices that can reach it: your own computer, or your phone on your Wi-Fi or Tailscale.

## The main pieces

| File | What it does |
|---|---|
| `server.js` | The watcher: reads Claude Code's logs and sends live updates. Also serves the web page and saves shared progress. |
| `public/index.html` | The dashboard page: panels, Clawd, sounds, celebrations. |
| `public/sprites.js` + `public/sprites/` | Which picture Clawd shows for each mood. Swap the art here. |
| `public/progress.js` | Your stats, records and badges, kept in the browser and synced through the watcher. |
| `public/deep.js` | The Stats, Replay and energy-meter screens. |
| `public/toys.js` | Mini-games and the hidden toy box. |
| `public/demo.js` | Demo mode: made-up sessions for when nothing real is running. |
| `electron/` | The Windows desktop mascot app. |
| `start.bat` / `start.sh` | One-click start: installs what's needed, then runs the watcher. |

## Demo mode, in one paragraph

When demo mode is on, the page quietly swaps where it gets its news. Instead of listening to the watcher, it listens to a script of made-up events. It saves its stats in a separate "demo" drawer, so your real progress is never touched, and Replay shows a made-up session instead of your real logs. The page reacts to those events exactly as it would to real ones, which is why the demo looks like the real thing. The DEMO badge and the dashed outlines are always there, so it can't be mistaken for your actual work.

## Progress and syncing

Your stats live in each browser. The watcher also keeps a copy in `progress.json`, so your computer and phone end up with the same record. When two devices disagree, the higher number wins, because both saw the same events. Unlocked badges are combined.

## What it never does

- It never sends anything to the internet.
- It never changes Claude Code's logs, your projects or your files. The only file it writes is its own `progress.json`.
- It never fakes being live. When the connection drops, the page says so, and demo mode is always labelled.
