#!/usr/bin/env bash
# Polls Pi undervoltage/thermal status plus current panel brightness/scene,
# for correlating power events with what the panel was doing at the time.
# Exact-moment undervoltage detection lives in power-watch.sh instead — this
# loop is for correlation, not detection, so a 1s poll is fine even though
# the underlying vcgencmd flags are latched (see plan/README for why).
set -u

LOG_FILE="${POWER_MONITOR_LOG:-$HOME/power-monitor.log}"
API_BASE="${LIGHTPANEL_API:-http://localhost:3000}"
POLL_SECONDS="${POWER_MONITOR_INTERVAL:-1}"

if [ ! -f "$LOG_FILE" ]; then
  echo "timestamp,undervoltage_now,undervoltage_since_boot,freq_capped_now,throttled_now,cpu_temp_c,brightness,active_scene_id" >> "$LOG_FILE"
fi

has_vcgencmd=0
command -v vcgencmd >/dev/null 2>&1 && has_vcgencmd=1

while true; do
  timestamp=$(date -Iseconds)

  if [ "$has_vcgencmd" -eq 1 ]; then
    throttled_hex=$(vcgencmd get_throttled 2>/dev/null | sed -n 's/^throttled=//p')
    throttled_dec=$((throttled_hex))
    undervoltage_now=$(((throttled_dec >> 0) & 1))
    freq_capped_now=$(((throttled_dec >> 1) & 1))
    throttled_now=$(((throttled_dec >> 2) & 1))
    undervoltage_since_boot=$(((throttled_dec >> 16) & 1))
    cpu_temp_c=$(vcgencmd measure_temp 2>/dev/null | sed -n "s/temp=\([0-9.]*\)'C/\1/p")
  else
    undervoltage_now="n/a"
    freq_capped_now="n/a"
    throttled_now="n/a"
    undervoltage_since_boot="n/a"
    cpu_temp_c="n/a"
  fi

  brightness=$(curl -s -m 2 "$API_BASE/api/brightness" 2>/dev/null)
  [ -z "$brightness" ] && brightness="n/a"

  active_scene_json=$(curl -s -m 2 "$API_BASE/api/active_scene" 2>/dev/null)
  active_scene_id=$(printf '%s' "$active_scene_json" | grep -oE '"id":"[^"]*"' | sed -E 's/"id":"([^"]*)"/\1/')
  if [ -z "$active_scene_id" ]; then
    active_scene_id=$(printf '%s' "$active_scene_json" | grep -oE '"id":[a-zA-Z0-9_]*' | sed -E 's/"id"://')
  fi
  [ -z "$active_scene_id" ] && active_scene_id="n/a"

  echo "$timestamp,$undervoltage_now,$undervoltage_since_boot,$freq_capped_now,$throttled_now,$cpu_temp_c,$brightness,$active_scene_id" >> "$LOG_FILE"

  sleep "$POLL_SECONDS"
done
