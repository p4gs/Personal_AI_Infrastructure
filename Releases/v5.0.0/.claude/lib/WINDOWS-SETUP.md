# PAI v5.0.0 — Windows 11 Setup Guide

> Native Windows 11 support for PAI (Personal AI Infrastructure).
> This guide covers installation and configuration on Windows 11 without WSL.

## Prerequisites

| Tool | Required | Install Command |
|------|----------|----------------|
| **Bun** | Yes | `winget install Oven-sh.Bun` or `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| **Git** | Yes | `winget install Git.Git` (also provides Git Bash, used by hooks/installer) |
| **Claude Code** | Yes | `npm install -g @anthropic-ai/claude-code` |
| **Windows Terminal** | Recommended | Pre-installed on Windows 11, or `winget install Microsoft.WindowsTerminal` |

### Verify Prerequisites

Open **PowerShell** or **Windows Terminal** and run:

```powershell
bun --version        # Should show 1.x+
git --version        # Should show 2.x+
claude --version     # Should show Claude Code version
```

## Installation

PAI v5.0.0 installs into `~/.claude` with PAI data living under
`~/.claude/PAI`.

```powershell
# 1. Clone PAI repository into the Claude home
git clone https://github.com/danielmiessler/PAI.git "$HOME\.claude"

# 2. Run the Windows bootstrap
cd "$HOME\.claude"
.\Bootstrap.bat
```

`Bootstrap.bat` invokes `install.ps1`, which runs the cross-platform install
engine (`PAI/PAI-Install/engine/actions.ts`) under Bun. On Windows the
installer skips macOS-only steps (launchd, `/etc/hosts` via sudo) and registers
Pulse as a **Task Scheduler** job instead.

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PAI_DIR` | PAI data directory | `%USERPROFILE%\.claude\PAI` |
| `PAI_CONFIG_DIR` | Configuration directory | `%APPDATA%\PAI` |
| `PAI_BASH_PATH` | (optional) explicit Git Bash path used by the installer when `bash` is not on the bun subprocess PATH | auto-detected from common Git for Windows locations |

To set permanently in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("PAI_DIR", "$HOME\.claude\PAI", "User")
[Environment]::SetEnvironmentVariable("PAI_CONFIG_DIR", "$env:APPDATA\PAI", "User")
```

> Note: `getPaiDir()` (in both `lib/platform.ts` and `hooks/lib/paths.ts`)
> resolves `PAI_DIR` env → `~/.claude/PAI`. The `/PAI` subdir is the v5.0.0
> convention and differs from v3.0's `~/.claude`.

### PowerShell Alias

Add to your PowerShell profile (`$PROFILE`):

```powershell
notepad $PROFILE

# Add this line:
function pai { bun "$HOME\.claude\skills\PAI\Tools\pai.ts" @args }
```

## Windows Compatibility Notes

### Hook Execution

Shell hooks run via `bun` on Windows (not bash). The `${PAI_DIR}` variable
expansion in `settings.json` hook commands is handled by Claude Code internally
before passing to the runtime.

PAI also provides `expandEnvVars()` in `lib/platform.ts` for any PAI code that
needs to expand `${VAR}` (Unix-style, all platforms) or `%VAR%` (Windows-only)
environment variables in command strings at runtime. For path-prefix expansion
(`$HOME`/`${HOME}`/`~` at the start of a path) use `expandPath()` from
`hooks/lib/paths.ts`. A literal `${HOME}` must never reach `mkdir`/`writeFile`.

### Installer Bash Invocation

The installer spawns `bash` for the canonical `PAI/PULSE/manage.sh` lifecycle
on macOS/Linux. On Windows, Git Bash is frequently absent from the bun
subprocess PATH, so the installer resolves a working `bash.exe` via
`platform.ts:getBashPath()` (Git for Windows locations + `PAI_BASH_PATH`
override). Windows Pulse lifecycle is handled by `PAI/PULSE/manage.ps1`
(Task Scheduler), so the macOS/Linux launchd-specific reload/menu-bar steps
are skipped on Windows.

### Voice / Pulse Server

Pulse runs on port 31337 across all platforms:
- **macOS:** `launchctl` with LaunchAgent plist (auto-start at login)
- **Linux:** background process / systemd user service
- **Windows:** Task Scheduler via `PAI\PULSE\manage.ps1` (runs at logon)

### Local HTTPS / hosts file

The `/etc/hosts` + `mkcert` + `launchctl` setup in `PAI/PULSE/setup.ts` is
macOS-only. On Windows/Linux those sections are guarded out (early return) so
they never execute. Configure local HTTPS manually on Windows if needed.

### Kitty Terminal

Kitty terminal is not available on Windows. The PAI terminal adapter pattern
gracefully degrades — `isKittyAvailable()` returns `false` on Windows,
`getKittySocketPath()` returns `null`, and `WindowsTerminalAdapter` provides
ANSI title-setting support. `hooks/lib/tab-setter.ts` already no-ops Kitty on
Windows and routes socket resolution through `platform.ts`.

### Credentials

OAuth credentials for usage stats are read from the macOS Keychain via the
`security` CLI on macOS. On Windows, `hooks/handlers/UpdateCounts.ts` uses
`keytar` (a `PAI/PULSE/package.json` dependency) with a graceful fallback to
the `~/.claude/.credentials.json` file. macOS behavior is unchanged.

## Architecture

PAI's Windows support is built on a centralized abstraction:

- **`lib/platform.ts`** — All platform-specific logic (OS detection, path
  resolution, command mapping, terminal detection, audio/notifications,
  service management, bash discovery, env-var expansion).
- **`lib/terminal.ts`** — Terminal adapter pattern (KittyTerminalAdapter,
  WindowsTerminalAdapter, GenericTerminalAdapter).
- **`hooks/lib/paths.ts`** — Cross-platform path resolution; `getPaiDir()`
  matches `platform.ts` exactly.
- **`hooks/lib/displayPath.ts`** — Backslash→slash normalization for display.

No inline `process.platform` checks are scattered across the codebase where a
`platform.ts` helper fits. All platform logic flows through `platform.ts`.

## Troubleshooting

### "bun: command not found"
```powershell
winget install Oven-sh.Bun
# Restart terminal after installation
```

### Installer fails with "bash not recognized" / spawn ENOENT
Ensure Git for Windows is installed (`winget install Git.Git`). If Git Bash is
in a non-standard location, set `PAI_BASH_PATH` to the full `bash.exe` path:
```powershell
[Environment]::SetEnvironmentVariable("PAI_BASH_PATH", "C:\Program Files\Git\bin\bash.exe", "User")
```

### Settings.json not found / wrong PAI dir
```powershell
echo $env:PAI_DIR
# Should output: C:\Users\YourName\.claude\PAI
```
