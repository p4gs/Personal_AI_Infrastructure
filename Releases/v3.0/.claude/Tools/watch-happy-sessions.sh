#!/usr/bin/env bash
# watch-happy-sessions.sh — WSL2-side Happy session creation watcher
#
# Tails the Windows Happy daemon log via the WSL mount and traces
# process ancestry (via powershell.exe) for every new session.
#
# Usage: bash watch-happy-sessions.sh
# Press Ctrl+C to stop.

set -euo pipefail

DAEMON_LOG="/mnt/c/Users/justi/.happy/logs/2026-02-21-18-34-19-pid-29580-daemon.log"
TRACE_LOG="/mnt/c/Users/justi/.happy/logs/session-watcher-$(date +%Y%m%d-%H%M%S).log"
SESSION_COUNT=0

log() {
  local ts
  ts=$(date '+%H:%M:%S.%3N')
  echo "[$ts] $1" | tee -a "$TRACE_LOG"
}

trace_ancestry() {
  local pid=$1
  # Query Win32_Process ancestry chain via PowerShell
  powershell.exe -NoProfile -Command "
    \$current = $pid
    \$visited = @{}
    for (\$i = 0; \$i -lt 15; \$i++) {
      if (\$visited.ContainsKey(\$current) -or \$current -le 0) { break }
      \$visited[\$current] = \$true
      \$proc = Get-CimInstance Win32_Process -Filter \"ProcessId=\$current\" -ErrorAction SilentlyContinue
      if (-not \$proc) {
        Write-Output \"  [\$i] PID \$current: DEAD (process already exited)\"
        break
      }
      \$cmd = if (\$proc.CommandLine) {
        \$proc.CommandLine.Substring(0, [Math]::Min(300, \$proc.CommandLine.Length))
      } else { '(no command line)' }
      Write-Output \"  [\$i] PID \$current | \$(\$proc.Name) | Parent: \$(\$proc.ParentProcessId) | CMD: \$cmd\"
      \$current = \$proc.ParentProcessId
    }
  " 2>/dev/null
}

check_tcp() {
  local pid=$1
  local port=$2
  powershell.exe -NoProfile -Command "
    Get-NetTCPConnection -OwningProcess $pid -ErrorAction SilentlyContinue |
      Where-Object { \$_.RemotePort -eq $port -or \$_.LocalPort -eq $port } |
      ForEach-Object { Write-Output \"    TCP: \$(\$_.LocalAddress):\$(\$_.LocalPort) -> \$(\$_.RemoteAddress):\$(\$_.RemotePort) [\$(\$_.State)]\" }
  " 2>/dev/null
}

# ── Banner ──────────────────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║  Happy Session Creation Watcher (WSL2 hybrid)           ║"
echo "  ║  Tails daemon log + traces Win32 process ancestry       ║"
echo "  ║  Press Ctrl+C to stop                                   ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo ""

if [[ ! -f "$DAEMON_LOG" ]]; then
  log "ERROR: Daemon log not found at $DAEMON_LOG"
  exit 1
fi

DAEMON_PORT=$(cat /mnt/c/Users/justi/.happy/daemon.state.json 2>/dev/null | grep -o '"httpPort":[0-9]*' | grep -o '[0-9]*')
log "Daemon port: $DAEMON_PORT"
log "Daemon log: $DAEMON_LOG"
log "Trace log: $TRACE_LOG"

# Record starting line count
LAST_LINES=$(wc -l < "$DAEMON_LOG")
log "Daemon log has $LAST_LINES lines — watching for new entries..."
echo ""

# ── Baseline snapshot ───────────────────────────────────────────────────────
log "── Baseline: Windows claude/happy/bun/node processes ──"
powershell.exe -NoProfile -Command "
  Get-CimInstance Win32_Process | Where-Object {
    \$_.Name -match 'claude|happy|bun|node'
  } | ForEach-Object {
    \$cmd = if (\$_.CommandLine) {
      \$_.CommandLine.Substring(0, [Math]::Min(200, \$_.CommandLine.Length))
    } else { '' }
    Write-Output \"  PID \$(\$_.ProcessId) | \$(\$_.Name) | Parent: \$(\$_.ParentProcessId) | \$cmd\"
  }
" 2>/dev/null | while IFS= read -r line; do
  log "$line"
done
echo ""
log "── Monitoring active — start 'happy' on Windows now ──"
echo ""

# ── Main loop ───────────────────────────────────────────────────────────────
while true; do
  CURRENT_LINES=$(wc -l < "$DAEMON_LOG")

  if (( CURRENT_LINES > LAST_LINES )); then
    # Read only new lines
    tail -n +"$((LAST_LINES + 1))" "$DAEMON_LOG" | while IFS= read -r line; do

      # Detect new session webhook
      if echo "$line" | grep -qP 'Session webhook: \S+, PID: \d+'; then
        SESSION_ID=$(echo "$line" | grep -oP 'Session webhook: \K\S+' | tr -d ',')
        PID=$(echo "$line" | grep -oP 'PID: \K\d+')
        SESSION_COUNT=$((SESSION_COUNT + 1))

        echo ""
        log "═══════════════════════════════════════════════════"
        log "NEW SESSION #$SESSION_COUNT: $SESSION_ID"
        log "HOST PID: $PID"
        log "═══════════════════════════════════════════════════"

        # IMMEDIATELY trace process ancestry
        log "── Process Ancestry Chain ──"
        trace_ancestry "$PID" | while IFS= read -r aline; do
          log "$aline"
        done

        # Check TCP connections to daemon port
        if [[ -n "$DAEMON_PORT" ]]; then
          check_tcp "$PID" "$DAEMON_PORT" | while IFS= read -r tline; do
            log "$tline"
          done
        fi
        echo ""
      fi

      # Detect session metadata
      if echo "$line" | grep -q '"path":'; then
        PATH_VAL=$(echo "$line" | grep -oP '"path": "\K[^"]+')
        log "  PATH: $PATH_VAL"
      fi

      # Detect stale cleanup
      if echo "$line" | grep -q 'stale session'; then
        log "STALE CLEANUP: $line"
      fi

      # Detect daemon spawn
      if echo "$line" | grep -qiP 'Spawning session|spawnSession|spawn.*claude'; then
        log "DAEMON SPAWN: $line"
      fi

      # Detect session started/ended
      if echo "$line" | grep -qi 'Session started\|Session ended\|lifecycle'; then
        log "LIFECYCLE: $line"
      fi

    done

    LAST_LINES=$CURRENT_LINES
  fi

  sleep 0.5
done
