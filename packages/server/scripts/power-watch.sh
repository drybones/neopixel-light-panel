#!/usr/bin/env bash
# Streams the kernel log for undervoltage/voltage messages as they happen,
# instead of sampling for them. journalctl -kf is a live follow (push, not
# poll), so it can't miss a transient dip between checks the way a polling
# loop could if the Pi freezes before its next tick.
set -u

LOG_FILE="${POWER_WATCH_LOG:-$HOME/power-watch.log}"

if ! command -v journalctl >/dev/null 2>&1; then
  echo "journalctl not found; power-watch.sh only works on the Pi (systemd journal)." >&2
  exit 1
fi

journalctl -kf -o short-precise | grep --line-buffered -i volt >> "$LOG_FILE"
