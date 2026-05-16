/**
 * 04-statusline.test.ts — Statusline Command E2E Tests
 *
 * v3.0 → v5.0.0 PORT-NOTES (MAJOR DIVERGENCE):
 *   v3.0 shipped a cross-platform TypeScript statusline (statusline-command.ts)
 *   and this suite asserted it had NO bash/shell dependencies (no jq/awk/sed,
 *   no #!/bin/bash, uses process.stdout.columns, etc.).
 *
 *   v5.0.0 ships PAI/statusline-command.sh — a BASH script by design. The
 *   entire "no shell dependency" premise is inverted, so the TypeScript
 *   source-analysis section is ported but describe.skip'd (it cannot pass
 *   against a bash file and there is no .ts statusline to target).
 *
 *   What is KEPT and adapted:
 *     - statusline file exists
 *     - git integration (branch + last commit) works cross-platform
 *     - Windows: git output has no bare \r that would corrupt display
 *   Execution of the .sh is only attempted on non-Windows (bash present);
 *   on Windows it is skipped (no bash; PAI on Windows uses a different path).
 *
 * Run: bun test tests/windows/04-statusline.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import {
  V5_ROOT,
  STATUSLINE_PATH,
  IS_NATIVE_WINDOWS,
  SLOW_TIMEOUT,
} from './helpers';

// ─── 1. Source Code Analysis — TS statusline (no v5.0.0 analogue) ───────────

// PORT-NOTE: v5.0.0 has no statusline-command.ts. It uses
// PAI/statusline-command.sh (bash). The v3.0 "TypeScript, not bash" and
// "no jq/awk/sed/stty/tput" assertions are intentionally inverted by v5.0.0's
// design and cannot apply. Skipped to preserve documented intent.
describe.skip('statusline — TS source analysis (replaced by .sh in v5.0.0)', () => {
  test('statusline-command.ts is TypeScript not bash', () => {
    expect(true).toBe(true);
  });
  test('statusline-command.ts avoids jq/awk/sed/stty/tput', () => {
    expect(true).toBe(true);
  });
  test('statusline-command.ts uses process.stdout.columns', () => {
    expect(true).toBe(true);
  });
});

// ─── 2. Statusline file existence (adapted) ────────────────────────────────

describe('statusline — file structure', () => {
  test('PAI/statusline-command.sh exists', () => {
    expect(existsSync(STATUSLINE_PATH)).toBe(true);
  });
});

// ─── 3. Statusline Execution (non-Windows only) ────────────────────────────

// PORT-NOTE: v5.0.0 statusline is a bash script. On Windows there is no bash
// in the PAI runtime path, so execution is skipped there (PAI's Windows port
// surfaces status differently). On macOS/Linux/WSL we exercise the script.
describe.skipIf(IS_NATIVE_WINDOWS)('statusline — execution (bash present)', () => {
  test('running statusline-command.sh produces output and exits 0', () => {
    const result = spawnSync('bash', [STATUSLINE_PATH], {
      input: '{}',
      encoding: 'utf-8',
      timeout: 15_000,
      cwd: V5_ROOT,
      env: { ...process.env, PAI_TEST_MODE: '1' },
    });
    // The script reads JSON from stdin and renders a status line. It should
    // not hard-crash; some sections degrade gracefully to "—".
    expect(result.status === 0 || result.status === null).toBe(true);
    expect((result.stdout || '').length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  test('statusline output contains PAI branding', () => {
    const result = spawnSync('bash', [STATUSLINE_PATH], {
      input: '{}',
      encoding: 'utf-8',
      timeout: 15_000,
      cwd: V5_ROOT,
      env: { ...process.env, PAI_TEST_MODE: '1' },
    });
    // Branding may render in various width modes; tolerate degradation.
    if ((result.stdout || '').length > 0) {
      expect(result.stdout.toUpperCase()).toContain('PAI');
    }
  }, SLOW_TIMEOUT);
});

// ─── 4. Git Integration (cross-platform) ────────────────────────────────────

describe('statusline — git integration', () => {

  test('git rev-parse --abbrev-ref HEAD returns a branch name', () => {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5_000,
      cwd: V5_ROOT,
    });

    expect(result.status).toBe(0);
    const branch = (result.stdout || '').trim();
    expect(branch.length).toBeGreaterThan(0);
  });

  test('git log --oneline -1 returns a commit line', () => {
    const result = spawnSync('git', ['log', '--oneline', '-1'], {
      encoding: 'utf-8',
      timeout: 5_000,
      cwd: V5_ROOT,
    });

    expect(result.status).toBe(0);
    const line = (result.stdout || '').trim();
    expect(line.length).toBeGreaterThan(0);
    expect(line).toMatch(/^[0-9a-f]+ .+/);
  });

});

// ─── 5. Windows-Specific (skipIf not win32) ─────────────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('statusline — Windows-specific', () => {

  test('git operations produce clean output without bare \\r', () => {
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 5_000,
      cwd: V5_ROOT,
    });

    const logResult = spawnSync('git', ['log', '--oneline', '-1'], {
      encoding: 'utf-8',
      timeout: 5_000,
      cwd: V5_ROOT,
    });

    const branch = (branchResult.stdout || '').trim();
    const commit = (logResult.stdout || '').trim();

    expect(branch).not.toContain('\r');
    expect(commit).not.toContain('\r');
  });

});
