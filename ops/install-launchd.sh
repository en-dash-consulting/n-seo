#!/usr/bin/env bash
# Install (or remove) the two macOS LaunchAgents for n-seo:
#   n-seo.dashboard  — the dashboard, kept alive, starts at login
#   n-seo.daily      — ops/daily.py at 07:00 local (fires on wake if missed)
#
# Usage:  ops/install-launchd.sh            install / reinstall
#         ops/install-launchd.sh --uninstall
#
# Idempotent: re-running replaces the plists and reloads the jobs.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES="$REPO/ops/templates"
AGENTS="$HOME/Library/LaunchAgents"
LABELS=(n-seo.dashboard n-seo.daily)
DOMAIN="gui/$(id -u)"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is for macOS launchd. On Linux see docs/SCHEDULING.md (cron / systemd)." >&2
  exit 1
fi

unload() {
  local label="$1" plist="$AGENTS/$1.plist"
  if launchctl print "$DOMAIN/$label" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$label" 2>/dev/null \
      || launchctl unload -w "$plist" 2>/dev/null || true
    echo "unloaded $label"
  fi
}

if [[ "${1:-}" == "--uninstall" ]]; then
  for label in "${LABELS[@]}"; do
    unload "$label"
    if [[ -f "$AGENTS/$label.plist" ]]; then
      rm -f "$AGENTS/$label.plist"
      echo "removed $AGENTS/$label.plist"
    fi
  done
  echo "done — n-seo LaunchAgents removed"
  exit 0
fi

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "node not found on PATH — install Node 20+ first" >&2
  exit 1
fi
NODE_BIN="$(dirname "$NODE")"

mkdir -p "$AGENTS" "$REPO/data"

for label in "${LABELS[@]}"; do
  src="$TEMPLATES/$label.plist"
  dst="$AGENTS/$label.plist"
  [[ -f "$src" ]] || { echo "missing template $src" >&2; exit 1; }
  unload "$label"
  sed -e "s|__REPO__|$REPO|g" \
      -e "s|__NODE_BIN__|$NODE_BIN|g" \
      -e "s|__HOME__|$HOME|g" "$src" > "$dst"
  plutil -lint "$dst" >/dev/null
  if launchctl bootstrap "$DOMAIN" "$dst" 2>/dev/null; then
    echo "loaded $label (bootstrap)"
  else
    launchctl load -w "$dst"
    echo "loaded $label (load -w)"
  fi
done

echo
echo "installed:"
echo "  $AGENTS/n-seo.dashboard.plist  → dashboard, log: $REPO/data/dashboard.log"
echo "  $AGENTS/n-seo.daily.plist      → ops/daily.py at 07:00, log: $REPO/data/daily-launchd.log"
echo
echo "restart the dashboard after code changes:"
echo "  launchctl kickstart -k $DOMAIN/n-seo.dashboard"
