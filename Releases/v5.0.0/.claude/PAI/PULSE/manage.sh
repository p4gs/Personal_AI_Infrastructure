#!/bin/bash
# PAI Pulse — Process Management (cross-platform)
# Usage: manage.sh {start|stop|restart|status|install|uninstall|logs}

PULSE_DIR="$HOME/.claude/PAI/PULSE"
PID_FILE="$PULSE_DIR/state/pulse.pid"
STATE_FILE="$PULSE_DIR/state/state.json"
LOG_FILE="$HOME/.claude/MEMORY/OBSERVABILITY/pulse-events.jsonl"
PULSE_HTTP="http://localhost:31337"

# ─── OS Detection ────────────────────────────────────────────────────────────
is_windows() {
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac
}

# Disable git bash POSIX→Windows path conversion on /flag-style arguments.
# Without this, schtasks /Run → C:/Program Files/Git/Run, etc.
# Harmless no-op on macOS/Linux.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Convert Unix path to Windows path (for powershell.exe -File)
to_winpath() {
  command -v cygpath &>/dev/null && cygpath -w "$1" || \
    echo "$1" | sed 's|^/\([a-zA-Z]\)/|\1:\\|; s|/|\\|g'
}

# Resolve bun executable (canonical paths first to avoid ephemeral shims)
if [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_PATH="$HOME/.bun/bin/bun"
elif [ -x "/opt/homebrew/bin/bun" ]; then
  BUN_PATH="/opt/homebrew/bin/bun"
elif [ -x "/usr/local/bin/bun" ]; then
  BUN_PATH="/usr/local/bin/bun"
else
  BUN_PATH="$(command -v bun || echo "$HOME/.bun/bin/bun")"
fi

# ─── macOS launchd config ─────────────────────────────────────────────────────
PLIST_NAME="com.pai.pulse"
PLIST_SRC="$PULSE_DIR/$PLIST_NAME.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

# ─── Windows Task Scheduler config ───────────────────────────────────────────
TASK_NAME="PAIPulse"

# ─── Subcommands ─────────────────────────────────────────────────────────────
case "$1" in
  start)
    if is_windows; then
      schtasks.exe /Run /TN "$TASK_NAME" 2>/dev/null \
        && echo "PAI Pulse started" \
        || { echo "ERROR: Failed to start $TASK_NAME (task not registered?)" >&2; exit 1; }
    else
      if [ ! -f "$PLIST_DST" ]; then
        sed -e "s|__HOME__|$HOME|g" -e "s|__BUN_PATH__|$BUN_PATH|g" "$PLIST_SRC" > "$PLIST_DST"
      fi
      launchctl load "$PLIST_DST" 2>/dev/null
      echo "PAI Pulse started"
    fi
    ;;

  stop)
    # Graceful HTTP shutdown first — works on all platforms
    if curl -sf --max-time 5 -X POST "$PULSE_HTTP/api/pulse/shutdown" 2>/dev/null; then
      echo "PAI Pulse: graceful shutdown sent"
      sleep 2
    fi
    if is_windows; then
      schtasks.exe /End /TN "$TASK_NAME" 2>/dev/null
      echo "PAI Pulse stopped"
    else
      launchctl unload "$PLIST_DST" 2>/dev/null
      if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        kill "$PID" 2>/dev/null
        echo "PAI Pulse stopped (PID $PID)"
      else
        echo "PAI Pulse stopped"
      fi
    fi
    ;;

  restart)
    "$0" stop
    sleep 2
    "$0" start
    ;;

  status)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if is_windows; then
        if tasklist.exe /FI "PID eq $PID" 2>/dev/null | grep -q "$PID"; then
          echo "PAI Pulse: RUNNING (PID $PID)"
        else
          echo "PAI Pulse: DEAD (stale PID $PID)"
        fi
      else
        if ps -p "$PID" > /dev/null 2>&1; then
          UPTIME=$(ps -p "$PID" -o etime= | xargs)
          echo "PAI Pulse: RUNNING (PID $PID, uptime $UPTIME)"
        else
          echo "PAI Pulse: DEAD (stale PID $PID)"
        fi
      fi
    else
      echo "PAI Pulse: NOT RUNNING (no PID file)"
    fi

    if is_windows; then
      echo ""
      schtasks.exe /Query /TN "$TASK_NAME" /FO LIST 2>/dev/null \
        | grep -E "Status|Last Run Time|Next Run Time" \
        || echo "  (task not registered)"
    fi

    if [ -f "$STATE_FILE" ]; then
      echo ""
      echo "Last job runs:"
      bun -e "
        const state = JSON.parse(require('fs').readFileSync('$STATE_FILE', 'utf-8'));
        for (const [name, info] of Object.entries(state.jobs)) {
          const ago = Math.round((Date.now() - info.lastRun) / 60000);
          const status = info.consecutiveFailures > 0 ? ' [FAILING x' + info.consecutiveFailures + ']' : '';
          console.log('  ' + name + ': ' + ago + ' min ago (' + info.lastResult + ')' + status);
        }
      " 2>/dev/null
    fi
    ;;

  install)
    mkdir -p "$PULSE_DIR/state" "$PULSE_DIR/logs"

    if is_windows; then
      # Resolve bun.exe Windows path — winget installs to a different path
      # than the curl-based installer, so use where.exe to find the real one
      BUN_WIN="$(where.exe bun 2>/dev/null | head -1 | tr -d '\r\n')"
      [ -z "$BUN_WIN" ] && BUN_WIN="$(to_winpath "$HOME/.bun/bin/bun.exe")"
      PULSE_TS_WIN="$(to_winpath "$PULSE_DIR/pulse.ts")"
      PULSE_DIR_WIN="$(to_winpath "$PULSE_DIR")"
      WIN_TASKUSER="$(whoami.exe 2>/dev/null | tr -d '\r\n' || printf '%s\%s' "${USERDOMAIN:-WORKGROUP}" "${USERNAME:-$(id -un)}")"

      TASK_XML="$(mktemp --suffix=.xml)"
      cat > "$TASK_XML" << TASK_XML_EOF
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>PAI Pulse — background AI infrastructure daemon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$WIN_TASKUSER</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$WIN_TASKUSER</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$BUN_WIN</Command>
      <Arguments>run "$PULSE_TS_WIN"</Arguments>
      <WorkingDirectory>$PULSE_DIR_WIN</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
TASK_XML_EOF
      schtasks.exe /Create /XML "$(to_winpath "$TASK_XML")" /TN "$TASK_NAME" /F 2>/dev/null
      SCHTASKS_RC=$?
      rm -f "$TASK_XML"
      [ "$SCHTASKS_RC" -eq 0 ] || { echo "ERROR: schtasks /Create failed (exit $SCHTASKS_RC)" >&2; exit 1; }
      echo "PAIPulse task registered (AtLogOn, restart×999 at 1m)"
      # Start it immediately (like launchctl load on macOS)
      schtasks.exe /Run /TN "$TASK_NAME" 2>/dev/null || true
    else
      # Cleanup any prior pulse before installing fresh — prevents stale-PID state
      if [ -f "$PLIST_DST" ]; then
        launchctl unload "$PLIST_DST" 2>/dev/null || true
      fi
      pkill -9 -f "bun.*pulse.ts" 2>/dev/null || true
      sleep 1
      sed -e "s|__HOME__|$HOME|g" -e "s|__BUN_PATH__|$BUN_PATH|g" "$PLIST_SRC" > "$PLIST_DST"
      launchctl load "$PLIST_DST"
    fi

    # Verify pulse binds :31337 within 10s (cross-platform)
    for _ in $(seq 1 20); do
      sleep 0.5
      if curl -sf --max-time 1 -o /dev/null -X POST "$PULSE_HTTP/notify" \
           -H "Content-Type: application/json" \
           -d '{"message":"","voice_enabled":false}' 2>/dev/null; then
        echo "PAI Pulse installed and verified on port 31337 (bun: $BUN_PATH)"
        exit 0
      fi
    done

    echo "ERROR: PAI Pulse installed but port 31337 did not bind within 10s." >&2
    echo "  Check: tail -50 $PULSE_DIR/logs/pulse-stderr.log" >&2
    exit 1
    ;;

  uninstall)
    "$0" stop || true
    if is_windows; then
      schtasks.exe /Delete /TN "$TASK_NAME" /F 2>/dev/null
    else
      launchctl unload "$PLIST_DST" 2>/dev/null
      rm -f "$PLIST_DST"
    fi
    echo "PAI Pulse uninstalled"
    ;;

  logs)
    if [ -f "$LOG_FILE" ]; then
      tail -50 "$LOG_FILE"
    else
      echo "No log file found at $LOG_FILE"
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|install|uninstall|logs}"
    exit 1
    ;;
esac
