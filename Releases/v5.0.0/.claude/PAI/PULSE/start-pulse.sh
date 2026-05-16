#!/bin/bash
# Start PAI Pulse daemon
# macOS/Linux: unlock keychain before starting
# Windows: credentials load from Credential Manager via keytar inside pulse.ts

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # Windows — no explicit keychain unlock needed. loadSecretsFromKeystore()
    # in pulse.ts reads API keys from Windows Credential Manager at startup.
    BUN_WIN="$HOME/.bun/bin/bun"
    if [ -x "$BUN_WIN" ]; then
      exec "$BUN_WIN" run pulse.ts
    elif command -v bun &>/dev/null; then
      exec bun run pulse.ts
    else
      echo "ERROR: bun not found. Install from https://bun.sh" >&2
      exit 1
    fi
    ;;
  *)
    # macOS/Linux — unlock keychain so Pulse can read API keys stored there
    security unlock-keychain -p "${PULSE_KEYCHAIN_PASSWORD:-changeme}" \
      ~/Library/Keychains/login.keychain-db 2>/dev/null
    exec "${HOME}/.bun/bin/bun" run pulse.ts 2>/dev/null || \
      exec /opt/homebrew/bin/bun run pulse.ts
    ;;
esac
