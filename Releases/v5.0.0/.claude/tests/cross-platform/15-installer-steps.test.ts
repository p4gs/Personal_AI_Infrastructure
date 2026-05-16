/**
 * 15-installer-steps.test.ts — Installer Engine Module Tests (Cross-Platform)
 *
 * Tests each installer engine module independently:
 *   - Core engine modules import without errors
 *   - detectSystem() returns well-formed detection data
 *   - createFreshState() produces correct initial state
 *   - STEPS array is complete (9 in v5.0.0), each well-formed
 *   - getStep(), getNextStep(), getProgress() behave correctly
 *   - generateSettingsJson() produces correct config structure
 *   - generateSummary() returns expected summary shape
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - INSTALL_DIR = PAI/PAI-Install (moved under PAI/).
 *   - STEPS array is 9 (was 8) — adds "telegram".
 *   - generateSummary.totalSteps === 9.
 *   - env.PAI_DIR carries a /PAI suffix (`${paiDir}/PAI`).
 *
 * Run: bun test tests/cross-platform/15-installer-steps.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { INSTALL_DIR, SLOW_TIMEOUT, safeImport } from '../windows/helpers';

type ConfigGenModule = {
  generateSettingsJson: (config: Record<string, any>) => Record<string, any>;
};
type DetectModule = {
  detectSystem: () => { os: { platform: string }; homeDir: string; paiDir: string; [k: string]: unknown };
};
type StateModule = {
  createFreshState: (mode: string) => {
    mode: string; currentStep: string; completedSteps: string[];
    skippedSteps: string[]; collected: Record<string, unknown>; [k: string]: unknown;
  };
};
type StepsModule = {
  STEPS: Array<{ id: string; name: string; number: number; description: string; dependsOn: string[] }>;
  getStep: (id: string) => { id: string; name: string; number: number };
  getNextStep: (state: any) => { id: string; name: string; number: number } | null;
  getProgress: (state: any) => number;
};
type ValidateModule = {
  generateSummary: (state: any) => { totalSteps: number; completedSteps: number; [k: string]: unknown };
};

// ─── Section 1: Module Imports ───────────────────────────────────────────────

describe('Installer Engine — Module Imports', () => {
  for (const mod of ['config-gen', 'detect', 'state', 'steps', 'validate']) {
    test(`${mod}.ts imports without error`, async () => {
      const result = await safeImport(`${INSTALL_DIR}/engine/${mod}`);
      expect(result.ok).toBe(true);
      if (!result.ok) console.error(`${mod} import error:`, result.error);
    }, SLOW_TIMEOUT);
  }
});

// ─── Section 2: System Detection ─────────────────────────────────────────────

describe('Installer Engine — detectSystem()', () => {
  test('returns object with os.platform, homeDir, and paiDir', async () => {
    const result = await safeImport<DetectModule>(`${INSTALL_DIR}/engine/detect`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detection = result.module.detectSystem();
    expect(detection.os).toBeDefined();
    expect(['darwin', 'linux', 'win32']).toContain(detection.os.platform);
    expect(detection.homeDir.length).toBeGreaterThan(0);
    expect(detection.paiDir.length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);
});

// ─── Section 3: State Management ─────────────────────────────────────────────

describe('Installer Engine — createFreshState()', () => {
  test('returns object with mode: "cli", currentStep, and collected', async () => {
    const result = await safeImport<StateModule>(`${INSTALL_DIR}/engine/state`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const state = result.module.createFreshState('cli');
    expect(state.mode).toBe('cli');
    expect(state.currentStep).toBe('system-detect');
    expect(Array.isArray(state.completedSteps)).toBe(true);
    expect(state.completedSteps.length).toBe(0);
    expect(Array.isArray(state.skippedSteps)).toBe(true);
    expect(state.skippedSteps.length).toBe(0);
    expect(typeof state.collected).toBe('object');
  }, SLOW_TIMEOUT);
});

// ─── Section 4: Step Definitions ─────────────────────────────────────────────

describe('Installer Engine — STEPS Array', () => {
  test('STEPS is an array with exactly 9 entries', async () => {
    const result = await safeImport<StepsModule>(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.STEPS.length).toBe(9); // PORT-NOTE: was 8 in v3.0
  }, SLOW_TIMEOUT);

  test('each step has id, name, and number fields', async () => {
    const result = await safeImport<StepsModule>(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const step of result.module.STEPS) {
      expect(step.id.length).toBeGreaterThan(0);
      expect(step.name.length).toBeGreaterThan(0);
      expect(step.number).toBeGreaterThanOrEqual(1);
      expect(step.number).toBeLessThanOrEqual(9);
    }
  }, SLOW_TIMEOUT);
});

// ─── Section 5: getStep() ────────────────────────────────────────────────────

describe('Installer Engine — getStep()', () => {
  test('getStep("system-detect") has matching id and a System/Detect name', async () => {
    const result = await safeImport<StepsModule>(`${INSTALL_DIR}/engine/steps`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.module.getStep('system-detect');
    expect(step.id).toBe('system-detect');
    expect(step.name.includes('System') || step.name.includes('Detect')).toBe(true);
  }, SLOW_TIMEOUT);
});

// ─── Section 6: getNextStep() ────────────────────────────────────────────────

describe('Installer Engine — getNextStep()', () => {
  test('returns first step (system-detect) for a fresh state', async () => {
    const stepsResult = await safeImport<StepsModule>(`${INSTALL_DIR}/engine/steps`);
    const stateResult = await safeImport<StateModule>(`${INSTALL_DIR}/engine/state`);
    expect(stepsResult.ok && stateResult.ok).toBe(true);
    if (!stepsResult.ok || !stateResult.ok) return;

    const freshState = stateResult.module.createFreshState('cli');
    const nextStep = stepsResult.module.getNextStep(freshState);
    expect(nextStep).not.toBeNull();
    expect(nextStep!.id).toBe('system-detect');
  }, SLOW_TIMEOUT);
});

// ─── Section 7: getProgress() ────────────────────────────────────────────────

describe('Installer Engine — getProgress()', () => {
  test('returns 0 for a fresh state with no completed steps', async () => {
    const stepsResult = await safeImport<StepsModule>(`${INSTALL_DIR}/engine/steps`);
    const stateResult = await safeImport<StateModule>(`${INSTALL_DIR}/engine/state`);
    expect(stepsResult.ok && stateResult.ok).toBe(true);
    if (!stepsResult.ok || !stateResult.ok) return;

    const freshState = stateResult.module.createFreshState('cli');
    expect(stepsResult.module.getProgress(freshState)).toBe(0);
  }, SLOW_TIMEOUT);
});

// ─── Section 8: generateSettingsJson() ───────────────────────────────────────

describe('Installer Engine — generateSettingsJson()', () => {
  const minimalConfig = {
    principalName: 'TestUser',
    timezone: 'America/New_York',
    aiName: 'TestAI',
    catchphrase: 'Hello, world',
    paiDir: '/home/test/.claude',
    configDir: '/home/test/.config/PAI',
  };

  test('returns object with env, principal, daidentity, and pai sections', async () => {
    const result = await safeImport<ConfigGenModule>(`${INSTALL_DIR}/engine/config-gen`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const settings = result.module.generateSettingsJson(minimalConfig);
    expect(settings.env).toBeDefined();
    expect(settings.principal).toBeDefined();
    expect(settings.daidentity).toBeDefined();
    expect(settings.pai).toBeDefined();
  }, SLOW_TIMEOUT);

  test('env.PAI_DIR is the provided paiDir + /PAI suffix', async () => {
    // PORT-NOTE: v3.0 asserted env.PAI_DIR === paiDir exactly. v5.0.0 appends
    // /PAI (the PAI subsystem dir). Assert the suffix relationship instead.
    const result = await safeImport<ConfigGenModule>(`${INSTALL_DIR}/engine/config-gen`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const settings = result.module.generateSettingsJson(minimalConfig);
    expect(settings.env.PAI_DIR).toBe(`${minimalConfig.paiDir}/PAI`);
  }, SLOW_TIMEOUT);

  test('principal.name matches provided principalName', async () => {
    const result = await safeImport<ConfigGenModule>(`${INSTALL_DIR}/engine/config-gen`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const settings = result.module.generateSettingsJson(minimalConfig);
    expect(settings.principal.name).toBe(minimalConfig.principalName);
  }, SLOW_TIMEOUT);
});

// ─── Section 9: generateSummary() ────────────────────────────────────────────

describe('Installer Engine — generateSummary()', () => {
  test('returns object with totalSteps (9) and completedSteps (0) for fresh state', async () => {
    const validateResult = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    const stateResult = await safeImport<StateModule>(`${INSTALL_DIR}/engine/state`);
    expect(validateResult.ok && stateResult.ok).toBe(true);
    if (!validateResult.ok || !stateResult.ok) return;

    const freshState = stateResult.module.createFreshState('cli');
    const summary = validateResult.module.generateSummary(freshState);
    expect(summary.totalSteps).toBe(9); // PORT-NOTE: was 8 in v3.0
    expect(summary.completedSteps).toBe(0);
  }, SLOW_TIMEOUT);
});
