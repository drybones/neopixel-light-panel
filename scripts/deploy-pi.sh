#!/usr/bin/env bash
# Deploys the light panel to the Pi (blinky): pulls origin/master, builds the
# UI there, and restarts the service. Mirrors the server's own deploy path —
# see the `deploy` skill (.claude/skills/deploy/SKILL.md) for the full
# checklist (branch preflight, verification, stale-branch cleanup) that
# wraps this script.
set -euo pipefail

ssh blinky '
  set -e
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  cd /home/pi/github/neopixel-light-panel
  git pull
  npm install
  npm run build --workspace=packages/ui
  sudo systemctl restart lightpanel
'
