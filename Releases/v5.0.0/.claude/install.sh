#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  PAI Installer v5.0 — Bootstrap Script
#  Requirements: bash, curl
#  This script bootstraps the installer by ensuring Bun is
#  available, then hands off to the TypeScript installer.
# ═══════════════════════════════════════════════════════════
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────
BLUE='\033[38;2;59;130;246m'
LIGHT_BLUE='\033[38;2;147;197;253m'
NAVY='\033[38;2;30;58;138m'
GREEN='\033[38;2;34;197;94m'
YELLOW='\033[38;2;234;179;8m'
RED='\033[38;2;239;68;68m'
GRAY='\033[38;2;100;116;139m'
STEEL='\033[38;2;51;65;85m'
SILVER='\033[38;2;203;213;225m'
RESET='\033[0m'
BOLD='\033[1m'
ITALIC='\033[3m'

# ─── Helpers ──────────────────────────────────────────────
info()    { echo -e "  ${BLUE}ℹ${RESET} $1"; }
success() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $1"; }
error()   { echo -e "  ${RED}✗${RESET} $1"; }

# ─── Resolve Script Directory + Algo Version (BEFORE banner — set -u) ──
# Banner displays Algo version read from LATEST; both must be defined first
# or `set -euo pipefail` aborts the script with "unbound variable" on line 46.
SOURCE_BANNER="${BASH_SOURCE[0]}"
while [ -L "$SOURCE_BANNER" ]; do
  DIR_BANNER="$(cd "$(dirname "$SOURCE_BANNER")" && pwd)"
  SOURCE_BANNER="$(readlink "$SOURCE_BANNER")"
  [[ "$SOURCE_BANNER" != /* ]] && SOURCE_BANNER="$DIR_BANNER/$SOURCE_BANNER"
done
SCRIPT_DIR_BANNER="$(cd "$(dirname "$SOURCE_BANNER")" && pwd)"
ALGO_VERSION_FILE="$SCRIPT_DIR_BANNER/PAI/ALGORITHM/LATEST"
if [ -f "$ALGO_VERSION_FILE" ]; then
  ALGO_VERSION_DISPLAY="v$(tr -d '[:space:]' < "$ALGO_VERSION_FILE" | sed 's/^v//')"
else
  ALGO_VERSION_DISPLAY="v?.?.?"
fi

# ─── Banner ───────────────────────────────────────────────
B='█'
SEP="${STEEL}│${RESET}"
BAR="${STEEL}────────────────────────${RESET}"

echo ""
echo -e "${STEEL}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${RESET}"
echo ""
echo -e "                      ${NAVY}P${RESET}${BLUE}A${RESET}${LIGHT_BLUE}I${RESET} ${STEEL}|${RESET} ${GRAY}Personal AI Infrastructure${RESET}"
echo ""
echo -e "                     ${ITALIC}${LIGHT_BLUE}\"Magnifying human capabilities...\"${RESET}"
echo ""
echo ""
echo -e "           ${NAVY}████████████████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${GRAY}\"${RESET}${LIGHT_BLUE}Welcome — let's get you set up${RESET}${GRAY}...\"${RESET}"
echo -e "           ${NAVY}████████████████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${BAR}"
echo -e "           ${NAVY}████${RESET}        ${NAVY}████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${NAVY}⬢${RESET}  ${GRAY}PAI${RESET}       ${SILVER}v5.0.0${RESET}"
echo -e "           ${NAVY}████${RESET}        ${NAVY}████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${NAVY}⚙${RESET}  ${GRAY}Algo${RESET}      ${SILVER}${ALGO_VERSION_DISPLAY}${RESET}"
echo -e "           ${NAVY}████████████████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${LIGHT_BLUE}✦${RESET}  ${GRAY}Installer${RESET} ${SILVER}v5.0${RESET}"
echo -e "           ${NAVY}████████████████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${BAR}"
echo -e "           ${NAVY}████${RESET}        ${BLUE}████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}"
echo -e "           ${NAVY}████${RESET}        ${BLUE}████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}  ${YELLOW}⚠  Alpha — rough edges expected${RESET}"
echo -e "           ${NAVY}████${RESET}        ${BLUE}████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}"
echo -e "           ${NAVY}████${RESET}        ${BLUE}████${RESET}${LIGHT_BLUE}████${RESET}   ${SEP}"
echo ""
echo ""
echo -e "                       ${STEEL}→${RESET} ${BLUE}github.com/danielmiessler/PAI${RESET}"
echo ""
echo -e "${STEEL}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${RESET}"
echo ""

# ─── Reuse pre-banner script-dir resolution ─────────────
# SCRIPT_DIR was already resolved before the banner so ALGO_VERSION_DISPLAY
# could render. Alias to the canonical SCRIPT_DIR name the rest of this
# script uses without re-walking the symlink chain.
SCRIPT_DIR="$SCRIPT_DIR_BANNER"

# ─── OS Detection ─────────────────────────────────────────
OS_RAW="$(uname -s)"
ARCH="$(uname -m)"

# Normalize Windows variants reported by MSYS2/git-bash (MINGW64_NT-10.0-…)
case "$OS_RAW" in
  MINGW*|MSYS*|CYGWIN*) OS="Windows" ;;
  *) OS="$OS_RAW" ;;
esac

case "$OS" in
  Darwin)  info "Platform: macOS ($ARCH)" ;;
  Linux)   info "Platform: Linux ($ARCH)" ;;
  Windows) info "Platform: Windows ($ARCH) — git bash detected" ;;
  *)       error "Unsupported platform: $OS_RAW"; exit 1 ;;
esac

# ─── Windows: native install via Windows CLI tools ────────────────────────
# All steps use Windows-native executables (winget.exe, reg.exe, icacls.exe,
# schtasks.exe, setx.exe) callable directly from git bash. No PowerShell.
if [ "$OS" = "Windows" ]; then

  # Disable git bash automatic POSIX→Windows path conversion on arguments.
  # Without this, schtasks /Create becomes C:/Program Files/Git/Create,
  # reg.exe /v becomes a filesystem path, icacls /inheritance:r fails, etc.
  export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

  # Convert a Unix path (/c/Users/…) to a Windows path (C:\Users\…)
  to_winpath() {
    command -v cygpath &>/dev/null && cygpath -w "$1" || \
      echo "$1" | sed 's|^/\([a-zA-Z]\)/|\1:\\|; s|/|\\|g'
  }

  # Install a package via winget if the named command isn't on PATH.
  # Uses where.exe as fallback because WinGet's links dir is on Windows PATH
  # but not in git bash's POSIX PATH, so command -v misses WinGet installs.
  win_require() {
    local cmd="$1" winget_id="$2" name="${3:-$1}"
    if command -v "$cmd" &>/dev/null || where.exe "$cmd" &>/dev/null 2>/dev/null; then
      success "$name already installed"
      return 0
    fi
    info "Installing $name via winget..."
    winget.exe install --id "$winget_id" --source winget --silent \
      --accept-package-agreements --accept-source-agreements 2>/dev/null || true
    export PATH="$PATH:$HOME/.bun/bin"
    if command -v "$cmd" &>/dev/null; then
      success "$name installed"
    else
      warn "$name may not be on PATH yet — restart terminal after setup completes"
    fi
  }

  # ── Dependencies ──────────────────────────────────────────────────────────
  # Check winget availability (preinstalled on Windows 11; warn if absent)
  if ! command -v winget.exe &>/dev/null; then
    warn "winget not found — install App Installer from the Microsoft Store first"
    warn "  https://aka.ms/getwinget"
  fi

  win_require git    "Git.Git"                  "git"
  win_require bun    "Oven-sh.Bun"              "bun"
  win_require rg     "BurntSushi.ripgrep.MSVC"  "ripgrep"
  win_require fd     "sharkdp.fd"               "fd"
  win_require bat    "sharkdp.bat"              "bat"
  win_require jq     "jqlang.jq"               "jq"
  win_require ffmpeg "Gyan.FFmpeg"              "ffmpeg"
  win_require sqlite3 "SQLite.SQLite"           "sqlite3"

  # Persist bun's bin dir in the user PATH registry value (survives reboots).
  # We use setx /M is not used (no admin needed for user scope).
  BUN_BIN_WIN="$(to_winpath "$HOME/.bun/bin")"
  CURRENT_USER_PATH="$(reg.exe query "HKCU\\Environment" /v PATH 2>/dev/null \
    | grep -i "PATH" | sed 's/.*REG_[A-Z_]* *//' | tr -d '\r')"
  if [[ "$CURRENT_USER_PATH" != *".bun\\bin"* ]]; then
    setx.exe PATH "$BUN_BIN_WIN;$CURRENT_USER_PATH" 2>/dev/null \
      && success "bun added to user PATH (restart terminal to take effect)" \
      || warn "Could not persist bun to PATH — add $BUN_BIN_WIN manually"
  fi

  # ── Long Paths ────────────────────────────────────────────────────────────
  info "Enabling LongPathsEnabled..."
  reg.exe add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" \
    /v LongPathsEnabled /t REG_DWORD /d 1 /f 2>/dev/null \
    && success "LongPathsEnabled = 1" \
    || warn "LongPathsEnabled: requires admin — run as admin to set, or set manually"
  git config --system core.longpaths true 2>/dev/null \
    && success "git core.longpaths = true" \
    || warn "git core.longpaths: requires admin git config"

  # ── Claude Code ───────────────────────────────────────────────────────────
  command -v claude &>/dev/null \
    && success "Claude Code found" \
    || warn "Claude Code not found — install during setup"

  # ── Append pai() to PowerShell $PROFILE ───────────────────────────────────
  # Default profile path: ~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1
  PS_PROFILE_DIR="$HOME/Documents/PowerShell"
  PS_PROFILE="$PS_PROFILE_DIR/Microsoft.PowerShell_profile.ps1"
  mkdir -p "$PS_PROFILE_DIR"
  [ -f "$PS_PROFILE" ] || touch "$PS_PROFILE"
  # Replace pai() if it points to the old v4 path (skills\PAI\Tools\pai.ts)
  if grep -q "skills.PAI.Tools.pai\.ts" "$PS_PROFILE" 2>/dev/null; then
    sed -i '/function pai/d' "$PS_PROFILE" 2>/dev/null || true
  fi
  if ! grep -q "PAI-Install" "$PS_PROFILE" 2>/dev/null; then
    # Single-quoted heredoc: no bash variable substitution — correct PS syntax
    cat >> "$PS_PROFILE" << 'PS_PROFILE_EOF'

# Added by PAI installer — launch PAI from anywhere
function pai {
    $bunPath = if (Get-Command bun -ErrorAction SilentlyContinue) { (Get-Command bun).Source } else { "$env:USERPROFILE\.bun\bin\bun.exe" }
    & $bunPath run "$env:USERPROFILE\.claude\PAI\PAI-Install\main.ts" @args
}
PS_PROFILE_EOF
    success "pai() added to $PS_PROFILE"
  else
    success "pai() already in profile — skipping"
  fi

  # ── Windows Defender exclusion for node_modules ───────────────────────────
  # Prevents AV from scanning every file during bun install (major speedup).
  # Registry equivalent of Add-MpPreference — no PowerShell required.
  info "Adding Windows Defender exclusion for node_modules..."
  NODE_MOD_WIN="$(to_winpath "$HOME/.claude/node_modules")"
  reg.exe add "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Exclusions\\Paths" \
    /v "$NODE_MOD_WIN" /t REG_DWORD /d 0 /f 2>/dev/null \
    && success "Defender exclusion added" \
    || warn "Defender exclusion: requires admin — add $NODE_MOD_WIN manually if bun install is slow"

  # Developer Mode note (needed for symlink creation)
  info "Note: symlink creation requires Developer Mode. Enable at:"
  info "  Settings → System → For developers → Developer Mode"

  # ── Launch TypeScript installer ───────────────────────────────────────────
  INSTALLER_DIR=""
  if   [ -d "$SCRIPT_DIR/PAI/PAI-Install" ]; then INSTALLER_DIR="$SCRIPT_DIR/PAI/PAI-Install"
  elif [ -d "$SCRIPT_DIR/PAI-Install" ];      then INSTALLER_DIR="$SCRIPT_DIR/PAI-Install"
  elif [ -f "$SCRIPT_DIR/main.ts" ];          then INSTALLER_DIR="$SCRIPT_DIR"
  else error "Cannot find PAI-Install directory."; exit 1
  fi

  if   [ "${PAI_TEST_AUTOMATED:-}" = "1" ]; then INSTALL_MODE="cli"; info "Automated mode."
  else                                           INSTALL_MODE="gui"
  fi

  # Reset .env ACLs so the installer wizard can clear and rewrite the file.
  # A previous install may have left owner-only icacls restrictions that block writes.
  ENV_EXISTING="$HOME/.claude/.env"
  if [ -f "$ENV_EXISTING" ]; then
    icacls.exe "$(to_winpath "$ENV_EXISTING")" /reset /Q 2>/dev/null || true
  fi

  # bun.exe is a native Windows binary — it needs Windows paths, not Unix paths.
  export PAI_BUNDLE_DIR="$(to_winpath "$SCRIPT_DIR")"
  info "Launching installer..."
  echo ""
  INSTALLER_TS_WIN="$(to_winpath "$INSTALLER_DIR/main.ts")"
  bun run "$INSTALLER_TS_WIN" --mode "$INSTALL_MODE"
  INSTALL_EXIT=$?

  if [ "$INSTALL_EXIT" -eq 0 ]; then
    # ── Set .env ACLs (owner-only) ─────────────────────────────────────────
    ENV_FILE="$HOME/.claude/.env"
    if [ -f "$ENV_FILE" ]; then
      ENV_WIN="$(to_winpath "$ENV_FILE")"
      # Normalize to LF line endings (avoids key=value parsing bugs)
      sed -i 's/\r//' "$ENV_FILE" 2>/dev/null || true
      # Strip inheritance, grant only current user full control
      icacls.exe "$ENV_WIN" /inheritance:r /grant:r "${USERNAME:-$USER}:F" \
        /deny "Everyone:(R)" 2>/dev/null \
        && success ".env ACLs set (owner-only)" \
        || warn ".env ACLs: icacls failed — set permissions manually"
    fi

    # ── Register Pulse as a Scheduled Task ────────────────────────────────
    info "Registering PAI Pulse scheduled task..."
    # Use where.exe to find the actual bun path — winget installs to a
    # different location than the curl-based installer (~/.bun/bin/).
    BUN_WIN="$(where.exe bun 2>/dev/null | head -1 | tr -d '\r\n')"
    [ -z "$BUN_WIN" ] && BUN_WIN="$(to_winpath "$HOME/.bun/bin/bun.exe")"
    PULSE_TS_WIN="$(to_winpath "$HOME/.claude/PAI/PULSE/pulse.ts")"
    PULSE_DIR_WIN="$(to_winpath "$HOME/.claude/PAI/PULSE")"
    # Get Windows-style user identity for the task principal
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
    TASK_XML_WIN="$(to_winpath "$TASK_XML")"
    schtasks.exe /Create /XML "$TASK_XML_WIN" /TN "PAIPulse" /F 2>/dev/null \
      && success "PAI Pulse task registered (AtLogOn, restart×999)" \
      || warn "Pulse task registration failed — run: manage.sh install"
    rm -f "$TASK_XML"
    # Start immediately (schtasks /Create only registers; start it now like launchctl load does)
    schtasks.exe /Run /TN "PAIPulse" 2>/dev/null || true

    # ── Migrate .env secrets to Windows Credential Manager ────────────────
    info "Migrating API keys to Windows Credential Manager..."
    MIGRATE_TS="$(mktemp --suffix=.ts)"
    cat > "$MIGRATE_TS" << 'MIGRATE_EOF'
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
const SENSITIVE_KEYS = [
  "ELEVENLABS_API_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_PRINCIPAL_CHAT_ID",
  "GITHUB_APP_ID","GITHUB_APP_PRIVATE_KEY_PATH","GITHUB_INSTALLATION_ID",
  "OPENAI_API_KEY","OPENROUTER_API_KEY","CLAUDE_CODE_OAUTH_TOKEN",
]
const envPath = join(homedir(), ".claude", ".env")
if (!existsSync(envPath)) process.exit(0)
let keytar: any
try { keytar = (await import("keytar")).default } catch {
  console.log("[migrate] keytar unavailable — secrets remain in .env (protected by ACL)")
  process.exit(0)
}
const lines = readFileSync(envPath, "utf-8").split("\n")
const out: string[] = []
let n = 0
for (const line of lines) {
  const t = line.trim()
  if (!t || t.startsWith("#")) { out.push(line); continue }
  const eq = t.indexOf("="); if (eq === -1) { out.push(line); continue }
  const key = t.slice(0, eq).trim()
  if (!SENSITIVE_KEYS.includes(key)) { out.push(line); continue }
  let val = t.slice(eq + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  if (!val) { out.push(line); continue }
  await keytar.setPassword("PAI", key, val)
  out.push(`# ${key} migrated to Windows Credential Manager (service=PAI)`)
  n++
}
if (n > 0) { writeFileSync(envPath, out.join("\n"), "utf-8"); console.log(`[migrate] Migrated ${n} secret(s)`) }
MIGRATE_EOF
    # bun.exe is a native Windows binary — convert mktemp's Unix path to Windows path
    MIGRATE_TS_WIN="$(to_winpath "$MIGRATE_TS")"
    bun run "$MIGRATE_TS_WIN" \
      && success "Credential migration complete (see above for details)" \
      || warn "Credential migration failed — secrets remain in .env (protected by ACL)"
    rm -f "$MIGRATE_TS"

    echo ""
    success "PAI installed successfully."
    info "To start PAI, open a new PowerShell window and run: pai"
  fi
  exit $INSTALL_EXIT
fi

# ─── Check curl ───────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  error "curl is required but not found."
  echo "  Please install curl and try again."
  exit 1
fi
success "curl found"

# ─── Check/Install Git ───────────────────────────────────
if command -v git &>/dev/null; then
  success "Git found: $(git --version 2>&1 | head -1)"
else
  warn "Git not found — attempting to install..."
  if [[ "$OS" == "Darwin" ]]; then
    if command -v brew &>/dev/null; then
      brew install git 2>/dev/null || warn "Could not install Git via Homebrew"
    else
      info "Installing Xcode Command Line Tools (includes Git)..."
      xcode-select --install 2>/dev/null || true
      echo "  Please complete the Xcode installation and re-run this script."
      exit 1
    fi
  elif [[ "$OS" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y git 2>/dev/null || warn "Could not install Git"
    elif command -v yum &>/dev/null; then
      sudo yum install -y git 2>/dev/null || warn "Could not install Git"
    fi
  fi

  if command -v git &>/dev/null; then
    success "Git installed: $(git --version 2>&1 | head -1)"
  else
    warn "Git could not be installed automatically. Please install it manually."
  fi
fi

# ─── Check/Install Bun ───────────────────────────────────
if command -v bun &>/dev/null; then
  success "Bun found: v$(bun --version 2>/dev/null || echo 'unknown')"
else
  info "Installing Bun runtime..."
  curl -fsSL https://bun.sh/install | bash 2>/dev/null

  # Add to PATH for this session
  export PATH="$HOME/.bun/bin:$PATH"

  if command -v bun &>/dev/null; then
    success "Bun installed: v$(bun --version 2>/dev/null || echo 'unknown')"
  else
    error "Failed to install Bun. Please install manually: https://bun.sh"
    exit 1
  fi
fi

# ─── Make bun reachable for non-interactive subprocess spawns ──────
# Critical for Claude Code hooks (`#!/usr/bin/env bun` shebang). The bun
# curl installer puts bun at ~/.bun/bin/bun and adds an export line to
# .zshrc — but .zshrc is only sourced for interactive shells. Hooks
# spawned by Claude Code inherit a non-interactive PATH where ~/.bun/bin
# is missing, so every .hook.ts silently fails to launch (voice doesn't
# fire, statusline can't run bun-based scripts, etc).
#
# Two-prong fix: (1) symlink to a system-wide location that's in every
# default PATH so /usr/bin/env can find it without any shell config,
# (2) add the export to .zshenv (which IS sourced for non-interactive zsh)
# and .zprofile (login shells).
if [ -x "$HOME/.bun/bin/bun" ]; then
  # System-wide symlink. Try writable target first; sudo only if needed.
  for target in /usr/local/bin /opt/homebrew/bin; do
    if [ -d "$target" ] && [ -w "$target" ] && [ ! -e "$target/bun" ]; then
      ln -sf "$HOME/.bun/bin/bun" "$target/bun" && success "Linked bun → $target/bun" && break
    fi
  done
  if ! command -v /usr/local/bin/bun &>/dev/null && ! command -v /opt/homebrew/bin/bun &>/dev/null; then
    # /usr/local/bin needs sudo — try non-fatally
    if sudo -n ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null; then
      success "Linked bun → /usr/local/bin/bun (via sudo)"
    else
      warn "Could not symlink bun system-wide. Hooks may fail in non-interactive shells."
      warn "  To fix manually: sudo ln -sf $HOME/.bun/bin/bun /usr/local/bin/bun"
    fi
  fi

  # Persist PATH to shell config files (idempotent).
  # .zshenv is sourced for ALL zsh invocations including non-interactive subshells.
  # .zprofile is sourced for login shells. .zshrc for interactive.
  # .bash_profile for bash login. We cover all four to be robust.
  BUN_EXPORT='export PATH="$HOME/.bun/bin:$PATH"'
  for rc in "$HOME/.zshenv" "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile"; do
    # Create the file if it doesn't exist (touch is harmless).
    [ -f "$rc" ] || touch "$rc"
    if ! grep -q '\.bun/bin' "$rc" 2>/dev/null; then
      echo "" >> "$rc"
      echo "# Added by PAI installer — make bun reachable for hook subprocesses" >> "$rc"
      echo "$BUN_EXPORT" >> "$rc"
      success "Added bun PATH export to $(basename "$rc")"
    fi
  done
fi

# ─── Check Claude Code ───────────────────────────────────
if command -v claude &>/dev/null; then
  success "Claude Code found"
else
  warn "Claude Code not found — will install during setup"
fi

# ─── Launch Installer ────────────────────────────────────
# Resolve PAI-Install directory. Canonical location is $SCRIPT_DIR/PAI/PAI-Install
# (install.sh lives at ~/.claude/ root). Fallbacks cover legacy nested layouts
# in case install.sh is executed from inside PAI-Install/.
INSTALLER_DIR=""
if [ -d "$SCRIPT_DIR/PAI/PAI-Install" ]; then
  INSTALLER_DIR="$SCRIPT_DIR/PAI/PAI-Install"
elif [ -d "$SCRIPT_DIR/PAI-Install" ]; then
  INSTALLER_DIR="$SCRIPT_DIR/PAI-Install"
elif [ -f "$SCRIPT_DIR/main.ts" ]; then
  INSTALLER_DIR="$SCRIPT_DIR"
else
  error "Cannot find PAI-Install directory. Expected at: $SCRIPT_DIR/PAI/PAI-Install/"
  exit 1
fi

# DA identity setup is handled by the wizard (main.ts → CLI or GUI), not by
# this bootstrap script. Running it here would duplicate prompts the wizard
# already asks. The wizard knows install order: copy files first, then DA.
echo ""

info "Launching installer..."
echo ""

# Auto-detect environments where the GUI installer can't render and fall
# back to CLI. Three triggers, any of which forces --mode cli:
#   1. Linux/BSD with no $DISPLAY / $WAYLAND_DISPLAY → headless
#   2. Any SSH session ($SSH_CONNECTION / $SSH_TTY set) → no console GUI
#   3. PAI_TEST_AUTOMATED=1 → harness runs (Tart/CI/etc.)
# `${VAR:-}` form survives `set -u` when the env var is unset.
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && [ "$(uname)" != "Darwin" ]; then
    INSTALL_MODE="cli"
    info "Headless environment detected — using CLI installer."
elif [ -n "${SSH_CONNECTION:-}" ] || [ -n "${SSH_TTY:-}" ]; then
    INSTALL_MODE="cli"
    info "SSH session detected — using CLI installer."
elif [ "${PAI_TEST_AUTOMATED:-}" = "1" ]; then
    INSTALL_MODE="cli"
    info "Automated test mode — using CLI installer."
else
    INSTALL_MODE="gui"
fi

# Export the bundle directory so the wizard can install from local files
# instead of git-cloning the public repo. SCRIPT_DIR is the directory
# containing this install.sh — the root of the v5 release bundle.
export PAI_BUNDLE_DIR="$SCRIPT_DIR"

# Run the wizard. We deliberately do NOT exec here — once the wizard exits we
# need to hand off to the user's interactive shell with `pai` already running.
bun run "$INSTALLER_DIR/main.ts" --mode "$INSTALL_MODE"
INSTALL_EXIT=$?

# Post-wizard handoff. Two paths, in priority order:
#
# 1. Controlling terminal accessible (any path where the user can see/type:
#    direct `bash install.sh`, SSH session running `curl … | sh`, local
#    `curl … | sh` in Terminal): redirect stdin from /dev/tty and exec into
#    `zsh -i -c 'source ~/.zshrc && pai'`. The /dev/tty redirect is what
#    makes this work under `curl | sh` — stdin to the install.sh process is
#    the curl pipe (not a TTY), but /dev/tty still resolves to the user's
#    actual controlling terminal, so the new zsh + pai inherit a real TTY
#    and Claude Code can read keystrokes. Without the redirect, pai would
#    launch with a closed-pipe stdin and immediately fail or hang.
#
# 2. No controlling terminal (true headless: CI harness, daemon spawn): print
#    the explicit one-liner. We deliberately do NOT fall through to
#    `osascript … Terminal` here — on a remote/headless macOS box that
#    silently opens a window the user can't see, leaving them thinking
#    nothing happened (the bug Daniel hit on server.baylander.lan).
if [ "$INSTALL_EXIT" -eq 0 ]; then
  echo ""
  if [ -r /dev/tty ]; then
    info "Launching pai..."
    exec zsh -i -c 'source ~/.zshrc && pai' < /dev/tty
  else
    info "Install complete. To start pai, run:  ${BOLD}source ~/.zshrc && pai${RESET}"
  fi
fi
exit $INSTALL_EXIT
