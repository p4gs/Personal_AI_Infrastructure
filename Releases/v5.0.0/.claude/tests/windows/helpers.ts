/**
 * Windows / Cross-Platform E2E Test Helpers (PAI v5.0.0)
 *
 * Shared utilities for the Windows 11 + cross-platform test suite.
 * Used by both local development testing and CI.
 *
 * Ported from PAI v3.0 (tests/windows/helpers.ts). v3.0 → v5.0.0 changes:
 *   - V3_ROOT → V5_ROOT (resolves the v5.0.0 .claude root)
 *   - Installer lives at PAI/PAI-Install/ (not top-level PAI-Install/)
 *   - VoiceServer lives at PAI/PULSE/VoiceServer/ (single voice.ts, no manage.ts/server.ts)
 *   - statusline is PAI/statusline-command.sh (bash, not statusline-command.ts)
 *   - Forbidden-pattern scan root retargeted to V5_ROOT, excludes lib/ + tests/
 *
 * Run all tests: bun test tests/ lib/
 */

import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { dirname, resolve, join, sep } from 'path';
import { existsSync, readdirSync } from 'fs';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Root of the v5.0.0 .claude directory (tests/windows → ../../) */
export const V5_ROOT = resolve(dirname(import.meta.dir), '..');

/** Backward-compat alias so ported v3.0 tests that referenced V3_ROOT still work */
export const V3_ROOT = V5_ROOT;

/** Hooks directory */
export const HOOKS_DIR = join(V5_ROOT, 'hooks');

/** Lib directory (created by the parallel platform-port agent) */
export const LIB_DIR = join(V5_ROOT, 'lib');

/**
 * PAI-Install directory.
 * v5.0.0: the installer moved under PAI/ (Electron + cli/ + web/ + engine/).
 */
export const INSTALL_DIR = join(V5_ROOT, 'PAI', 'PAI-Install');

/** Voice server directory. v5.0.0: PAI/PULSE/VoiceServer/ (single voice.ts). */
export const VOICE_DIR = join(V5_ROOT, 'PAI', 'PULSE', 'VoiceServer');

/** Statusline script. v5.0.0: PAI/statusline-command.sh (bash, not TS). */
export const STATUSLINE_PATH = join(V5_ROOT, 'PAI', 'statusline-command.sh');

/** Whether we're running on actual Windows */
export const IS_NATIVE_WINDOWS = process.platform === 'win32';

/** Whether we're running on macOS */
export const IS_MACOS = process.platform === 'darwin';

/** Whether we're running on Linux (includes WSL2) */
export const IS_LINUX = process.platform === 'linux';

/**
 * Kitty terminal environment is active (mirrors detectTerminal()'s kitty
 * predicate in lib/platform.ts: TERM===xterm-kitty || KITTY_WINDOW_ID).
 * When true, detectTerminal() CORRECTLY returns 'kitty', so the
 * Windows-Terminal-expectation tests are not meaningful — they assert
 * clean-environment (CI / PowerShell, no kitty) behavior. PAI itself runs in
 * kitty, so an interactive dev `bun test` inherits these vars; CI does not.
 * Guarding those tests on this keeps them honest (skip when their precondition
 * cannot hold) instead of spuriously failing.
 */
export const KITTY_ENV_ACTIVE =
  process.env.TERM === 'xterm-kitty' || !!process.env.KITTY_WINDOW_ID;

/** Test timeout for potentially slow operations (WSL2 filesystem, grep) */
export const SLOW_TIMEOUT = 30_000;

/** Test timeout for hook execution */
export const HOOK_TIMEOUT = 15_000;

// ─── Hook Testing ─────────────────────────────────────────────────────────────

/** All hook filenames (v5.0.0 has ~38 hooks vs v3.0's 22) */
export const ALL_HOOKS = existsSync(HOOKS_DIR)
  ? readdirSync(HOOKS_DIR)
      .filter(f => f.endsWith('.hook.ts'))
      .sort()
  : [];

/**
 * Execute a hook with JSON stdin and capture output.
 * Simulates how Claude Code invokes hooks.
 */
export function executeHook(
  hookFile: string,
  stdinJson: Record<string, unknown>,
  timeoutMs = HOOK_TIMEOUT
): { stdout: string; stderr: string; exitCode: number | null; error?: string } {
  const hookPath = join(HOOKS_DIR, hookFile);
  if (!existsSync(hookPath)) {
    return { stdout: '', stderr: '', exitCode: null, error: `Hook not found: ${hookPath}` };
  }

  const result = spawnSync('bun', ['run', hookPath], {
    input: JSON.stringify(stdinJson),
    encoding: 'utf-8',
    timeout: timeoutMs,
    cwd: V5_ROOT,
    env: {
      ...process.env,
      // Prevent hooks from doing destructive things during tests
      PAI_TEST_MODE: '1',
    },
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
    error: result.error?.message,
  };
}

/**
 * Check if a hook can be imported without crashing.
 * Uses `bun -e` with a dynamic import to test module loading.
 */
export function canImportHook(hookFile: string): { ok: boolean; error?: string } {
  const hookPath = join(HOOKS_DIR, hookFile);
  const result = spawnSync('bun', ['-e', `import("${hookPath.replace(/\\/g, '/')}")`], {
    encoding: 'utf-8',
    timeout: 10_000,
    cwd: V5_ROOT,
    env: {
      ...process.env,
      PAI_TEST_MODE: '1',
    },
  });

  // Exit code 0 = imported fine; null = timed out (interactive hook waiting for stdin)
  const ok = result.status === 0 || result.status === null;
  return {
    ok,
    error: ok ? undefined : (result.stderr || result.error?.message || `exit ${result.status}`),
  };
}

// ─── Pattern Counting ─────────────────────────────────────────────────────────

/**
 * Count forbidden pattern matches in v5.0.0 TypeScript files.
 * Excludes test files, CLAUDE.md, lib/platform.ts itself, and the tests dir.
 * Works on both Windows (Bun scan) and Unix (grep).
 */
export function countForbiddenPattern(pattern: string): number {
  try {
    if (IS_NATIVE_WINDOWS) {
      return countPatternViaBun(pattern);
    }

    const result = spawnSync('grep', [
      '-rn', pattern,
      '--include=*.ts',
      V5_ROOT,
    ], { encoding: 'utf-8', timeout: 15_000 });

    const lines = (result.stdout || '').split('\n').filter(line =>
      line.length > 0 &&
      !line.includes('.test.ts') &&
      !line.includes('CLAUDE.md') &&
      !line.includes('lib/platform.ts') &&
      !line.includes('lib\\platform.ts') &&
      !line.includes('tests/windows/') &&
      !line.includes('tests/cross-platform/') &&
      !line.includes('tests\\windows\\') &&
      !line.includes('tests\\cross-platform\\') &&
      !line.includes('node_modules/') &&
      !line.includes('smoke-test-windows.ts')
    );
    return lines.length;
  } catch {
    return -1; // Error state
  }
}

/**
 * Cross-platform pattern counting using Bun's file reading.
 * Slower than grep but works identically on Windows and Unix.
 */
function countPatternViaBun(pattern: string): number {
  const regex = new RegExp(pattern);
  let count = 0;

  function scanDir(dir: string): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            !entry.name.startsWith('.') &&
            entry.name !== 'node_modules' &&
            entry.name !== 'tests'
          ) {
            scanDir(fullPath);
          }
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.test.ts') &&
          entry.name !== 'platform.ts' &&
          entry.name !== 'smoke-test-windows.ts' &&
          !fullPath.includes('tests/windows') &&
          !fullPath.includes('tests\\windows') &&
          !fullPath.includes('tests/cross-platform') &&
          !fullPath.includes('tests\\cross-platform')
        ) {
          try {
            const content = require('fs').readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
              if (regex.test(line) && !line.includes('CLAUDE.md')) {
                count++;
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  scanDir(V5_ROOT);
  return count;
}

// ─── Path Validation ──────────────────────────────────────────────────────────

/** Check if a path uses the correct separator for the current platform */
export function hasCorrectSeparator(path: string): boolean {
  if (IS_NATIVE_WINDOWS) {
    return path.includes('\\');
  }
  return path.includes('/');
}

/** Check if a path is absolute */
export function isAbsolutePath(path: string): boolean {
  if (IS_NATIVE_WINDOWS) {
    return /^[A-Za-z]:\\/.test(path) || path.startsWith('\\\\');
  }
  return path.startsWith('/');
}

/** Check if a string contains hardcoded Unix paths */
export function hasHardcodedUnixPaths(content: string): boolean {
  return /\/usr\/bin\/|\/bin\/(?!ary)|\/tmp\/|\/dev\//.test(content);
}

/** Check if a string contains hardcoded Windows paths */
export function hasHardcodedWindowsPaths(content: string): boolean {
  return /C:\\\\|%APPDATA%|%USERPROFILE%/.test(content);
}

// ─── Module Import Testing ────────────────────────────────────────────────────

/**
 * Dynamically import a module and check it doesn't throw.
 * Returns the module exports or an error.
 */
export async function safeImport<T = Record<string, unknown>>(
  modulePath: string
): Promise<{ ok: true; module: T } | { ok: false; error: string }> {
  try {
    const mod = await import(modulePath) as T;
    return { ok: true, module: mod };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ─── Spawn Helpers ────────────────────────────────────────────────────────────

/** Run a bun command and return the result */
export function bunRun(
  args: string[],
  options?: { cwd?: string; input?: string; timeout?: number }
): SpawnSyncReturns<string> {
  return spawnSync('bun', args, {
    encoding: 'utf-8',
    timeout: options?.timeout ?? 15_000,
    cwd: options?.cwd ?? V5_ROOT,
    input: options?.input,
    env: { ...process.env, PAI_TEST_MODE: '1' },
  });
}

/** Run a bun script file */
export function bunRunFile(
  filePath: string,
  options?: { input?: string; timeout?: number }
): { stdout: string; stderr: string; exitCode: number | null } {
  const result = bunRun(['run', filePath], options);
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
  };
}

// ─── Skills & Handlers ──────────────────────────────────────────────────────

/** Skills directory */
export const SKILLS_DIR = join(V5_ROOT, 'skills');

/** Handlers directory */
export const HANDLERS_DIR = join(HOOKS_DIR, 'handlers');

/** All handler files */
export const ALL_HANDLERS = existsSync(HANDLERS_DIR)
  ? readdirSync(HANDLERS_DIR).filter(f => f.endsWith('.ts')).sort()
  : [];

// ─── Hook Event Inputs ──────────────────────────────────────────────────────

/** Standard SessionStart hook input */
export const SESSION_START_INPUT = {
  session_id: 'test-ci-00000000',
  session_type: 'interactive',
  event: 'init',
  conversation: [],
};

/** Standard UserPromptSubmit hook input */
export const USER_PROMPT_INPUT = {
  session_id: 'test-ci-00000000',
  event: 'user_prompt_submit',
  user_prompt: 'Hello',
  conversation: [{ role: 'user', content: 'Hello' }],
};

/** Standard PreToolUse hook input */
export const PRE_TOOL_USE_INPUT = {
  session_id: 'test-ci-00000000',
  event: 'pre_tool_use',
  tool_name: 'Bash',
  tool_input: { command: 'echo test' },
};

/** Standard PostToolUse hook input */
export const POST_TOOL_USE_INPUT = {
  session_id: 'test-ci-00000000',
  event: 'post_tool_use',
  tool_name: 'Bash',
  tool_result: 'test',
};

/** Standard SessionEnd hook input */
export const SESSION_END_INPUT = {
  session_id: 'test-ci-00000000',
  event: 'session_end',
  transcript_path: '',
};

/** Standard Stop hook input */
export const STOP_INPUT = {
  session_id: 'test-ci-00000000',
  transcript_path: '',
  hook_event_name: 'Stop',
};

/** Standard PreCompact hook input */
export const PRECOMPACT_INPUT = {
  session_id: 'test-ci-00000000',
  trigger: 'auto',
  custom_instructions: '',
};

/**
 * True if an import/build error is an optional-dependency resolution failure
 * (NOT a syntax/platform regression). Bun/Node phrase this several ways.
 */
export function isDependencyError(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return (
    msg.includes('Could not resolve') ||
    msg.includes('Cannot find module') ||
    msg.includes('Cannot find package') ||
    msg.includes('No matching export') ||
    msg.includes('Failed to resolve')
  );
}

/** Dummy API keys for skill invocation testing in CI */
export const DUMMY_API_ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-dummy-ci-test-key',
  OPENAI_API_KEY: 'sk-dummy-ci-test-key',
  APIFY_TOKEN: 'apify_dummy_ci_token',
  BRIGHTDATA_API_KEY: 'brightdata_dummy_ci_key',
};
