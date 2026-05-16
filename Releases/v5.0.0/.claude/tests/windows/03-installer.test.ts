/**
 * 03-installer.test.ts — Installer Engine Tests (Windows / Cross-Platform Suite)
 *
 * Validates the PAI v5.0.0 installer engine works on all platforms:
 *   - Engine modules import without errors
 *   - State management functions work correctly
 *   - Step definitions are well-formed
 *   - Windows-specific platform guards
 *   - System detection runs without crashing
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - Installer moved from PAI-Install/ to PAI/PAI-Install/ (INSTALL_DIR helper).
 *   - STEPS array is 9 entries in v5.0.0 (was 8) — adds "telegram" step.
 *   - detectSystem() is the canonical detection entry point (runSystemDetect
 *     wraps it with an event emitter). Tests call detectSystem() directly.
 *   - v5.0.0 actions.ts no longer hardcodes 'irm bun.sh/install.ps1' or a
 *     multi-profile PowerShell loop ('for (const psProfilePath...)'); the
 *     v3.0 PowerShell-profile source-analysis sections are ported but
 *     describe.skip'd (see PORT-NOTE) since there is no v5.0.0 analogue.
 *
 * Run: bun test tests/windows/03-installer.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  INSTALL_DIR,
  V5_ROOT,
  IS_NATIVE_WINDOWS,
  SLOW_TIMEOUT,
  safeImport,
} from './helpers';

// ─── Section 1: Module Loading (cross-platform) ────────────────────────────

describe('Installer Module Loading', () => {
  test('PAI-Install/engine/actions.ts imports cleanly', async () => {
    const result = await safeImport(`${INSTALL_DIR}/engine/actions`);
    expect(result.ok).toBe(true);
    if (!result.ok) console.error('actions.ts import error:', result.error);
  }, SLOW_TIMEOUT);

  test('PAI-Install/engine/state.ts imports cleanly', async () => {
    const result = await safeImport(`${INSTALL_DIR}/engine/state`);
    expect(result.ok).toBe(true);
    if (!result.ok) console.error('state.ts import error:', result.error);
  }, SLOW_TIMEOUT);

  test('PAI-Install/engine/steps.ts imports cleanly', async () => {
    const result = await safeImport(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);
    if (!result.ok) console.error('steps.ts import error:', result.error);
  }, SLOW_TIMEOUT);

  test('PAI-Install/engine/validate.ts imports cleanly', async () => {
    const result = await safeImport(`${INSTALL_DIR}/engine/validate`);
    expect(result.ok).toBe(true);
    if (!result.ok) console.error('validate.ts import error:', result.error);
  }, SLOW_TIMEOUT);

  test('PAI-Install/cli/display.ts imports cleanly', async () => {
    const result = await safeImport(`${INSTALL_DIR}/cli/display`);
    expect(result.ok).toBe(true);
    if (!result.ok) console.error('display.ts import error:', result.error);
  }, SLOW_TIMEOUT);
});

// ─── Section 2: State Management (cross-platform) ──────────────────────────

describe('State Management', () => {
  test('createFreshState() returns object with currentStep and completedSteps', async () => {
    const result = await safeImport<{
      createFreshState: (mode: string) => {
        currentStep: string;
        completedSteps: string[];
      };
    }>(`${INSTALL_DIR}/engine/state`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const state = result.module.createFreshState('cli');
      expect(state).toBeDefined();
      expect(typeof state.currentStep).toBe('string');
      expect(state.currentStep).toBe('system-detect');
      expect(Array.isArray(state.completedSteps)).toBe(true);
      expect(state.completedSteps.length).toBe(0);
    }
  }, SLOW_TIMEOUT);

  test('hasSavedState() returns boolean without throwing', async () => {
    const result = await safeImport<{
      hasSavedState: () => boolean;
    }>(`${INSTALL_DIR}/engine/state`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const hasState = result.module.hasSavedState();
      expect(typeof hasState).toBe('boolean');
    }
  }, SLOW_TIMEOUT);
});

// ─── Section 3: Steps Configuration (cross-platform) ───────────────────────

describe('Steps Configuration', () => {
  test('STEPS is an array with at least 5 entries', async () => {
    const result = await safeImport<{
      STEPS: Array<{ id: string; name: string; description: string }>;
    }>(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(Array.isArray(result.module.STEPS)).toBe(true);
      expect(result.module.STEPS.length).toBeGreaterThanOrEqual(5);
    }
  }, SLOW_TIMEOUT);

  test('each step has id, name, and description', async () => {
    const result = await safeImport<{
      STEPS: Array<{ id: string; name: string; description: string }>;
    }>(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      for (const step of result.module.STEPS) {
        expect(typeof step.id).toBe('string');
        expect(step.id.length).toBeGreaterThan(0);
        expect(typeof step.name).toBe('string');
        expect(step.name.length).toBeGreaterThan(0);
        expect(typeof step.description).toBe('string');
        expect(step.description.length).toBeGreaterThan(0);
      }
    }
  }, SLOW_TIMEOUT);

  test('step IDs include system-detect, prerequisites, and api-keys', async () => {
    const result = await safeImport<{
      STEPS: Array<{ id: string }>;
    }>(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const ids = result.module.STEPS.map(s => s.id);
      expect(ids).toContain('system-detect');
      expect(ids).toContain('prerequisites');
      expect(ids).toContain('api-keys');
    }
  }, SLOW_TIMEOUT);
});

// ─── Section 4: Windows-specific Installer Paths ───────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('Windows-specific Installer Paths', () => {
  test('platform module reports isWindows as true', async () => {
    const result = await safeImport<{
      isWindows: boolean;
    }>(`${V5_ROOT}/lib/platform`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.module.isWindows).toBe(true);
    }
  }, SLOW_TIMEOUT);

  test('shell profile path contains PowerShell', async () => {
    const result = await safeImport<{
      getShellProfilePath: () => string;
    }>(`${V5_ROOT}/lib/platform`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const profilePath = result.module.getShellProfilePath();
      expect(profilePath).toContain('PowerShell');
    }
  }, SLOW_TIMEOUT);

  test('chmod/chown functions report as unavailable via platform guard', async () => {
    const result = await safeImport<{
      isCommandAvailable: (cmd: string) => boolean;
      isWindows: boolean;
    }>(`${V5_ROOT}/lib/platform`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.module.isCommandAvailable('chmod')).toBe(false);
      expect(result.module.isCommandAvailable('chown')).toBe(false);
    }
  }, SLOW_TIMEOUT);
});

// ─── Section 5: System Detection (cross-platform) ──────────────────────────

describe('System Detection', () => {
  test('detectSystem() returns a well-formed detection object', async () => {
    // PORT-NOTE: v3.0 called runSystemDetect(state, emit). In v5.0.0
    // detectSystem() is the pure detection function; runSystemDetect()
    // wraps it with an event emitter and mutates state. Test the pure fn.
    const result = await safeImport<{
      detectSystem: () => {
        os: { platform: string };
        tools: Record<string, unknown>;
        homeDir: string;
        paiDir: string;
      };
    }>(`${INSTALL_DIR}/engine/detect`);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const detection = result.module.detectSystem();
      expect(detection).toBeDefined();
      expect(detection).toHaveProperty('os');
      expect(detection).toHaveProperty('tools');
      expect(detection).toHaveProperty('homeDir');
      expect(typeof detection.os.platform).toBe('string');
      expect(typeof detection.homeDir).toBe('string');
      expect(detection.homeDir.length).toBeGreaterThan(0);
    }
  }, SLOW_TIMEOUT);
});

// ─── Section 6: PowerShell Profile Detection — Source Analysis ──────────────

// PORT-NOTE: v3.0's actions.ts hardcoded 'irm bun.sh/install.ps1', the strings
// 'Write-Host $PROFILE', 'WindowsPowerShell', and a multi-profile loop
// 'for (const psProfilePath of profilePaths)'. v5.0.0's actions.ts was
// rewritten and no longer contains these markers (Bun install / PS-profile
// wiring moved to the Electron/web installer and prerequisites flow). These
// v3.0 source-analysis assertions have no v5.0.0 analogue, so they are ported
// but skipped to preserve documented intent without false failures.
describe.skip('PowerShell Profile Detection — Source Analysis (no v5.0.0 analogue)', () => {
  test('actions.ts detects PS 5.1 profile via powershell.exe $PROFILE', () => {
    expect(true).toBe(true);
  });
  test('actions.ts detects PS 7+ profile via pwsh.exe $PROFILE', () => {
    expect(true).toBe(true);
  });
  test('actions.ts writes pai function to multiple detected profiles', () => {
    expect(true).toBe(true);
  });
});

// ─── Section 7: Windows-only Profile Path E2E ───────────────────────────────

// PORT-NOTE: v3.0 wrote a `pai` function into the live PowerShell profile and
// verified `Get-Command pai`. v5.0.0 installs the shell shim differently
// (Bootstrap.bat / install.sh wiring), and there is no installer-driven
// PS-profile write in actions.ts to mirror. Ported but skipped — the
// generic PS $PROFILE smoke test below stays active to keep Windows coverage.
describe.skipIf(!IS_NATIVE_WINDOWS)('Windows PowerShell environment smoke', () => {
  test('PowerShell $PROFILE resolves to a .ps1 path on Windows', () => {
    const { spawnSync } = require('child_process');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Write-Host $PROFILE'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    const profilePath = (result.stdout || '').trim();
    expect(profilePath.length).toBeGreaterThan(0);
    expect(profilePath).toEndWith('.ps1');
  }, SLOW_TIMEOUT);
});
