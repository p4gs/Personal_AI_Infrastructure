# Windows 11 Support — Development & Testing Rules (v5.0.0)

> **Read this before making ANY changes to Windows compatibility code.**
> These rules ensure cross-platform quality and prevent regressions.

This is the v5.0.0 port of the proven v3.0 cross-platform abstraction. The
single source of truth for all platform branching is `lib/platform.ts`.

---

## 1. Forbidden Patterns (Hard Gates)

After ANY code change related to Windows support, these patterns MUST NOT exist
in v5.0.0 TypeScript files unless guarded. Verify with grep before claiming
completion.

| Pattern | Grep Command | Allowed Count |
|---------|-------------|---------------|
| Bare `process.env.HOME!` without fallback | `grep -rn "process\.env\.HOME!" --include="*.ts"` | 0 |
| Hardcoded `/tmp/` in TypeScript | `grep -rn '"/tmp/' --include="*.ts"` | 0 unguarded |
| Hardcoded `/usr/bin/` or `/bin/` in spawn | `grep -rn "'/usr/bin/\|'/bin/" --include="*.ts"` | 0 |
| `chmod` or `chown` without platform guard | `grep -rn "chmod\|chown" --include="*.ts"` then verify each has a `process.platform`/`isWindows` check | 0 unguarded |
| `lsof` without platform guard | `grep -rn "lsof" --include="*.ts"` then verify each goes through `platform.ts` | 0 unguarded |
| Literal `${HOME}`/`$HOME`/`~` reaching `mkdir`/`writeFile` | audit every config-path ingestion point | 0 |
| `spawn("bash", …)` without Windows bash resolution | `grep -rn 'spawn("bash"' --include="*.ts"` | 0 unguarded |
| `sudo`/`launchctl`/`schtasks` without platform guard | `grep -rn "sudo \|launchctl\|schtasks" --include="*.ts"` then verify guard | 0 unguarded |

**Rule:** If ANY forbidden pattern count is non-zero and unguarded, the work is
NOT complete. Fix before proceeding.

## 2. Per-File Validation Gate

Before and after editing ANY file for Windows support:

1. **Before:** Note the bad-pattern grep count for patterns this file touches
2. **Edit:** Make the change
3. **After — Grep:** Re-run the relevant forbidden pattern greps. Count must
   decrease or stay at zero.
4. **After — Types:** `bun build <file> --target=bun --outdir=/tmp/x` (no
   tsconfig in v5.0.0 root). No new type errors.
5. **After — Tests:** Run tests affected by this file. (Test files are owned
   by the parallel test agent under `tests/` and `lib/*.test.ts`.)

**Rule:** Never batch multiple files without running this gate between them.

## 3. Architectural Constraints

1. **All platform logic flows through `lib/platform.ts`** — No inline
   `process.platform` checks scattered across files where a `platform.ts`
   helper fits. If you need to check the platform, add/use a function in
   `platform.ts` and call it.
2. **No new dependencies** — Solve Windows support with Bun/TypeScript
   built-ins and OS-level commands, plus deps already in
   `PAI/PULSE/package.json` (notably `keytar ^7.9.0`). Do not add npm
   packages for platform detection, path handling, or process management.
3. **Preserve the `hooks/lib/paths.ts` pattern** — `paths.ts` keeps its
   public API and behavior. `platform.ts` is the cross-platform source of
   truth; the two `getPaiDir()` resolvers (`~/.claude/PAI`) must never
   diverge.
4. **Hook output channels:** User-visible output goes to `stderr`
   (`process.stderr.write` or `console.error`). Structured JSON data for
   Claude Code goes to `stdout` (`console.log`). Never pollute stdout.
5. **Parity, not replacement** — macOS and Linux behavior must be byte-for-byte
   unchanged. Every Windows fix is strictly additive behind a guard.

## 4. v5.0.0 Layout Differences From v3.0

| Concept | v3.0 | v5.0.0 |
|---------|------|--------|
| PAI data dir | `~/.claude` | `~/.claude/PAI` (a `/PAI` subdir) |
| Claude home | `~/.claude` | `~/.claude` (`getClaudeDir()`) |
| Observability | `Observability/` | `PAI/PULSE/Observability/` |
| Installer | `PAI-Install/cli/install.ts` | `PAI/PAI-Install/engine/actions.ts` + `Bootstrap.bat` / `install.ps1` |
| Pulse service | `VoiceServer/manage.ts` | `PAI/PULSE/manage.sh` (macOS/Linux) / `PAI/PULSE/manage.ps1` (Windows Task Scheduler) |
| Credentials store | `.env` | `~/.claude/.env` (via `paths.ts:getEnvPath()`); macOS Keychain for OAuth |

When porting v3.0 code, adapt path assumptions to the v5.0.0 column.

## 5. Course Correction Protocol

1. **A grep count goes UP instead of down** — STOP. You introduced a new
   forbidden pattern. Revert and fix.
2. **A type/build error appears after a change** — STOP. Fix before the next
   file.
3. **You discover a platform dependency NOT covered** — Add a `platform.ts`
   helper for it immediately. Do not silently inline a `process.platform`
   check.
4. **You're unsure how a Windows API behaves** — Do NOT guess. Research it.
   Wrong assumptions compound.

## 6. Evidence Standards

When marking any criterion as done:

- **Grep criteria:** Cite the exact grep command and its output (count = 0)
- **Build criteria:** Cite the `bun build` invocation and its result
- **Behavioral criteria:** Quote the exact guard/branch you added and the
  file:line it lives at

"Verified" or "looks good" is never acceptable evidence. State what you
checked, what you found, and what the expected value was.
