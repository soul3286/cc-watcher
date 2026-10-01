#!/bin/sh
# Start CC Watcher on macOS or Linux: installs Node.js (Homebrew) and the two libraries on first run, then opens the
# dashboard. Run it with:  sh start.sh
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-4790}"; export PORT
URL="http://localhost:$PORT"
open_url() { (open "$1" || xdg-open "$1") >/dev/null 2>&1 & }

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js is not installed. Installing it with Homebrew..."
    brew install node || exit 1
  else
    echo "Node.js is needed. Opening nodejs.org - install the LTS version, then run this again."
    open_url https://nodejs.org
    exit 1
  fi
fi

if curl -fs "$URL/manifest.webmanifest" >/dev/null 2>&1; then
  echo "CC Watcher is already running. Opening $URL"
  open_url "$URL"
  exit 0
fi

if [ ! -d node_modules/ws ]; then
  echo "Installing libraries (first run only)..."
  npm install --omit=dev --no-audit --no-fund || exit 1
fi

(sleep 2; open_url "$URL") &
echo "CC Watcher is running at $URL - press Ctrl+C to stop."
exec node server.js
