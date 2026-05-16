/**
 * 10-install-e2e.test.ts — PAI Installer Engine E2E Tests
 *
 * Tests the PAI v5.0.0 installer engine (detect, steps, validate, config-gen)
 * against REAL platform behavior. No mocking of process.platform.
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - Installer moved to PAI/PAI-Install/ (INSTALL_DIR helper).
 *   - STEPS array is 9 in v5.0.0 (was 8) — adds "telegram" (a conditional step).
 *     Step-count assertions updated 8 → 9; getProgress uses applicable
 *     (non-condition-skipped) steps so a fresh state still yields 0.
 *   - InstallState.version is INSTALLER_VERSION ("5.0"); PAI_VERSION is "5.0.0".
 *   - generateSettingsJson output shape changed: env.PAI_DIR = `${paiDir}/PAI`,
 *     principal.name/timezone, daidentity.name, pai.version. No top-level
 *     `pai.version === "3.0"` — now "5.0.0".
 *   - generateSummary.totalSteps === 9; no activationCommand/activationHint
 *     (those v3.0 fields don't exist in v5.0.0 — see test 22 skip).
 *   - manage.ts CLI tests removed (no v5.0.0 analogue — see test 09 PORT-NOTE).
 *
 * Run: bun test tests/windows/10-install-e2e.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  INSTALL_DIR,
  IS_NATIVE_WINDOWS,
  IS_MACOS,
  IS_LINUX,
  SLOW_TIMEOUT,
} from './helpers';

// ─── Installer Engine Imports ────────────────────────────────────────────────

import { detectSystem } from '../../PAI/PAI-Install/engine/detect';
import { STEPS, getStep, getNextStep, getProgress } from '../../PAI/PAI-Install/engine/steps';
import type { InstallState, DetectionResult } from '../../PAI/PAI-Install/engine/types';
import { generateSettingsJson } from '../../PAI/PAI-Install/engine/config-gen';

// ─── Helper: minimal fresh InstallState ──────────────────────────────────────

function freshState(overrides: Partial<InstallState> = {}): InstallState {
  return {
    version: '5.0',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStep: 'system-detect',
    completedSteps: [],
    skippedSteps: [],
    mode: 'cli',
    detection: null,
    collected: {},
    installType: null,
    errors: [],
    ...overrides,
  } as InstallState;
}

// ─── 1. System Detection (cross-platform) ───────────────────────────────────

describe('installer — system detection', () => {
  let detection: DetectionResult;

  beforeAll(() => {
    detection = detectSystem();
  });

  test('detectSystem returns a valid DetectionResult object', () => {
    expect(detection).toHaveProperty('os');
    expect(detection).toHaveProperty('shell');
    expect(detection).toHaveProperty('tools');
    expect(detection).toHaveProperty('existing');
    expect(detection).toHaveProperty('homeDir');
    expect(detection).toHaveProperty('paiDir');
  });

  test('detection.os.platform matches actual process.platform category', () => {
    if (process.platform === 'darwin') {
      expect(detection.os.platform).toBe('darwin');
    } else if (process.platform === 'win32') {
      expect(detection.os.platform).toBe('win32');
    } else {
      expect(detection.os.platform).toBe('linux');
    }
  });

  test('detection.os.arch is a non-empty string', () => {
    expect(detection.os.arch.length).toBeGreaterThan(0);
  });

  test('detection.os.name is a non-empty string', () => {
    expect(detection.os.name.length).toBeGreaterThan(0);
  });

  test('detection.shell has name, version, and path', () => {
    expect(detection.shell).toHaveProperty('name');
    expect(detection.shell).toHaveProperty('version');
    expect(detection.shell).toHaveProperty('path');
    expect(detection.shell.name.length).toBeGreaterThan(0);
  });

  test('detection.tools.bun.installed is true (we are running under Bun)', () => {
    expect(detection.tools.bun.installed).toBe(true);
  });

  test('detection.tools.git.installed is true (required for checkout)', () => {
    expect(detection.tools.git.installed).toBe(true);
  });

  test('detection.homeDir is an absolute path that exists', () => {
    expect(detection.homeDir.length).toBeGreaterThan(0);
    expect(existsSync(detection.homeDir)).toBe(true);
  });

  test('detection.paiDir ends with .claude', () => {
    expect(detection.paiDir).toEndWith('.claude');
  });

  test('detection.timezone is a non-empty string', () => {
    expect(detection.timezone.length).toBeGreaterThan(0);
  });

});

// ─── 2. Step Definitions ─────────────────────────────────────────────────────

describe('installer — step definitions', () => {

  test('STEPS array has exactly 9 steps', () => {
    // PORT-NOTE: v3.0 had 8; v5.0.0 adds "telegram".
    expect(STEPS.length).toBe(9);
  });

  test('all 9 step IDs are present', () => {
    const ids = STEPS.map(s => s.id);
    expect(ids).toContain('system-detect');
    expect(ids).toContain('prerequisites');
    expect(ids).toContain('api-keys');
    expect(ids).toContain('identity');
    expect(ids).toContain('repository');
    expect(ids).toContain('configuration');
    expect(ids).toContain('voice');
    expect(ids).toContain('telegram');
    expect(ids).toContain('validation');
  });

  test('steps are numbered 1 through 9', () => {
    for (let i = 0; i < STEPS.length; i++) {
      expect(STEPS[i].number).toBe(i + 1);
    }
  });

  test('first step (system-detect) has no dependencies', () => {
    const step = getStep('system-detect');
    expect(step.dependsOn.length).toBe(0);
  });

  test('each non-first step depends on the previous step', () => {
    for (let i = 1; i < STEPS.length; i++) {
      expect(STEPS[i].dependsOn.length).toBeGreaterThan(0);
    }
  });

  test('getNextStep returns system-detect for a fresh state', () => {
    const next = getNextStep(freshState());
    expect(next).not.toBeNull();
    expect(next!.id).toBe('system-detect');
  });

  test('getProgress returns 0 for a fresh state', () => {
    expect(getProgress(freshState())).toBe(0);
  });

  test('getProgress returns 100 when all applicable steps complete', () => {
    // PORT-NOTE: v5.0.0 getProgress() denominator is applicable steps
    // (condition-skipped steps excluded). Completing every step id yields 100.
    const state = freshState({
      currentStep: 'validation',
      completedSteps: STEPS.map(s => s.id),
    });
    expect(getProgress(state)).toBe(100);
  });

});

// ─── 3. Configuration Generation ─────────────────────────────────────────────

describe('installer — configuration generation', () => {

  const cfg = {
    principalName: 'TestUser',
    timezone: 'America/Los_Angeles',
    aiName: 'TestAI',
    catchphrase: 'Hello World',
    paiDir: join(tmpdir(), '.claude-test'),
    configDir: join(tmpdir(), '.config-test'),
  };

  test('generateSettingsJson returns an object with required fields', () => {
    const config = generateSettingsJson(cfg as any);

    expect(config).toHaveProperty('principal');
    expect(config).toHaveProperty('daidentity');
    expect(config.principal.name).toBe('TestUser');
    expect(config.principal.timezone).toBe('America/Los_Angeles');
    expect(config.daidentity.name).toBe('TestAI');
  });

  test('generateSettingsJson includes PAI version field', () => {
    const config = generateSettingsJson({ ...cfg, principalName: 'Test', timezone: 'UTC', aiName: 'PAI', catchphrase: 'Ready' } as any);
    expect(config).toHaveProperty('pai');
    expect(config.pai).toHaveProperty('version');
  });

  test('generateSettingsJson env.PAI_DIR carries the /PAI suffix', () => {
    // PORT-NOTE: v5.0.0 writes env.PAI_DIR = `${config.paiDir}/PAI`
    // (the PAI subsystem dir, not the install root).
    const config = generateSettingsJson(cfg as any);
    expect(String(config.env.PAI_DIR)).toContain('PAI');
    expect(String(config.env.PAI_DIR).endsWith('PAI')).toBe(true);
  });

  test('generateSettingsJson output is valid JSON when stringified', () => {
    const config = generateSettingsJson({ ...cfg, principalName: 'Test' } as any);
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json);
    expect(parsed.principal.name).toBe('Test');
  });

});

// ─── 4. Directory Structure Creation ─────────────────────────────────────────

describe('installer — directory structure', () => {
  const TEST_DIR = join(tmpdir(), `pai-install-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  test('required directories can be created on this platform', () => {
    const requiredDirs = [
      'MEMORY',
      'MEMORY/STATE',
      'MEMORY/LEARNING',
      'MEMORY/WORK',
      'hooks',
      'skills',
      'Plans',
    ];

    for (const dir of requiredDirs) {
      const fullPath = join(TEST_DIR, dir);
      mkdirSync(fullPath, { recursive: true });
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  test('settings.json can be written and read back', () => {
    const settingsPath = join(TEST_DIR, 'settings.json');
    const config = { principal: { name: 'Test' }, pai: { version: '5.0.0' } };
    writeFileSync(settingsPath, JSON.stringify(config, null, 2));

    expect(existsSync(settingsPath)).toBe(true);
    const read = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(read.principal.name).toBe('Test');
  });

  test('cleanup: remove test directory', () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    expect(existsSync(TEST_DIR)).toBe(false);
  });

});

// ─── 5. Validation Module ────────────────────────────────────────────────────

describe('installer — validation module', () => {

  test('validation module can be imported', async () => {
    const mod = await import('../../PAI/PAI-Install/engine/validate');
    expect(mod).toHaveProperty('runValidation');
    expect(mod).toHaveProperty('generateSummary');
  });

  test('generateSummary returns correct structure for a near-complete state', async () => {
    const { generateSummary } = await import('../../PAI/PAI-Install/engine/validate');
    const state = freshState({
      currentStep: 'validation',
      completedSteps: ['system-detect', 'prerequisites', 'api-keys', 'identity', 'repository', 'configuration', 'voice'] as any,
      collected: {
        principalName: 'TestUser',
        aiName: 'TestAI',
        timezone: 'UTC',
        catchphrase: 'Hello',
      } as any,
      installType: 'fresh',
    });

    const summary = generateSummary(state);
    expect(summary.principalName).toBe('TestUser');
    expect(summary.aiName).toBe('TestAI');
    expect(summary.installType).toBe('fresh');
    expect(summary.completedSteps).toBe(7);
    expect(summary.totalSteps).toBe(9); // PORT-NOTE: was 8 in v3.0
  });

});

// ─── 6. Windows-Specific Install Tests ───────────────────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('installer — Windows-specific', () => {
  let detection: DetectionResult;

  beforeAll(() => {
    detection = detectSystem();
  });

  test('detectOS returns win32 platform', () => {
    expect(detection.os.platform).toBe('win32');
  });

  test('detectOS name contains Windows', () => {
    expect(detection.os.name).toContain('Windows');
  });

  test('detectShell returns powershell on Windows', () => {
    expect(detection.shell.name).toBe('powershell');
  });

  test('detectShell path contains powershell (case-insensitive)', () => {
    expect(detection.shell.path.toLowerCase()).toContain('powershell');
  });

  test('detectTool finds bun with a Windows path', () => {
    expect(detection.tools.bun.installed).toBe(true);
    if (detection.tools.bun.path) {
      expect(
        detection.tools.bun.path.includes('\\') ||
        detection.tools.bun.path.toLowerCase().endsWith('.exe')
      ).toBe(true);
    }
  });

  test('detectTool finds git', () => {
    expect(detection.tools.git.installed).toBe(true);
  });

  test('paiDir uses Windows home directory path', () => {
    expect(detection.homeDir).toMatch(/^[A-Za-z]:\\/);
    expect(detection.paiDir).toMatch(/^[A-Za-z]:\\/);
  });

});

// ─── 7. macOS-Specific Install Tests ─────────────────────────────────────────

describe.skipIf(!IS_MACOS)('installer — macOS-specific', () => {
  let detection: DetectionResult;

  beforeAll(() => {
    detection = detectSystem();
  });

  test('detectOS returns darwin platform', () => {
    expect(detection.os.platform).toBe('darwin');
  });

  test('detectOS name contains macOS', () => {
    expect(detection.os.name).toContain('macOS');
  });

  test('brew detection returns a result (may or may not be installed)', () => {
    expect(detection.tools.brew).toHaveProperty('installed');
  });

});

// ─── 8. Linux-Specific Install Tests ─────────────────────────────────────────

describe.skipIf(!IS_LINUX)('installer — Linux-specific', () => {
  let detection: DetectionResult;

  beforeAll(() => {
    detection = detectSystem();
  });

  test('detectOS returns linux platform', () => {
    expect(detection.os.platform).toBe('linux');
  });

  test('shell is not powershell on Linux', () => {
    expect(detection.shell.name).not.toBe('powershell');
  });

  test('homeDir starts with /', () => {
    expect(detection.homeDir).toStartWith('/');
  });

});
