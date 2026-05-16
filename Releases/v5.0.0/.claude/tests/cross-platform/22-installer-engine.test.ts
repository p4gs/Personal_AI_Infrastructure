/**
 * 22-installer-engine.test.ts — Installer Engine Validation & Summary Tests (Cross-Platform)
 *
 * Tests installer engine functions with real temp directory structures:
 *   - runValidation() individual checks (settings.json, fields, directories)
 *   - generateSummary() field behavior
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - INSTALL_DIR = PAI/PAI-Install; runValidation(state, emit?) — emit is now
 *     optional and omitted in tests.
 *   - validate.ts reads state.detection?.paiDir / configDir (v3.0 read the
 *     same fields). buildState() sets state.detection.paiDir/configDir.
 *   - Check name "Voice server" → "Pulse (voice + dashboard)" in v5.0.0
 *     (voice absorbed into Pulse). Detail "Not reachable" preserved.
 *   - generateSummary().totalSteps === 9 (was 8). voiceMode is
 *     elevenlabs / macos-say / none (NOT platform-specific windows-sapi —
 *     v5.0.0 dropped the per-OS branch). There is NO activationCommand /
 *     activationHint in v5.0.0 InstallSummary — those v3.0 assertions are
 *     ported but describe.skip'd.
 *
 * Run: bun test tests/cross-platform/22-installer-engine.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { INSTALL_DIR, SLOW_TIMEOUT, safeImport, IS_NATIVE_WINDOWS } from '../windows/helpers';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type ValidateModule = {
  runValidation: (state: any) => Promise<Array<{
    name: string; passed: boolean; detail: string; critical: boolean;
  }>>;
  generateSummary: (state: any) => {
    paiVersion: string; principalName: string; aiName: string; timezone: string;
    voiceEnabled: boolean; voiceMode: string; catchphrase: string;
    installType: string; completedSteps: number; totalSteps: number;
  };
};

function buildState(overrides: {
  paiDir?: string;
  configDir?: string;
  collected?: Record<string, unknown>;
  completedSteps?: string[];
  installType?: string | null;
} = {}): any {
  return {
    version: '5.0',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStep: 'validation',
    completedSteps: overrides.completedSteps ?? [],
    skippedSteps: [],
    mode: 'cli',
    detection: {
      paiDir: overrides.paiDir ?? '/nonexistent',
      configDir: overrides.configDir ?? '/nonexistent-config',
      os: { platform: process.platform, arch: process.arch, version: '', name: '' },
      shell: { name: '', version: '', path: '' },
      tools: {
        bun: { installed: true }, git: { installed: true },
        claude: { installed: false }, node: { installed: false },
        brew: { installed: false },
      },
      existing: { paiInstalled: false, hasApiKeys: false, elevenLabsKeyFound: false, backupPaths: [] },
      timezone: 'UTC',
      homeDir: tmpdir(),
    },
    collected: overrides.collected ?? {},
    installType: overrides.installType ?? null,
    errors: [],
  };
}

let tempRoot: string;
let s1PaiDir: string, s1ConfigDir: string;
let s2PaiDir: string;
let s3PaiDir: string;
let s4PaiDir: string;
let s5PaiDir: string;
let s6PaiDir: string, s6ConfigDir: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'pai-test-22-'));

  // S1: full valid structure
  s1PaiDir = join(tempRoot, 's1-pai');
  s1ConfigDir = join(tempRoot, 's1-config');
  mkdirSync(s1PaiDir, { recursive: true });
  mkdirSync(s1ConfigDir, { recursive: true });
  writeFileSync(join(s1PaiDir, 'settings.json'), JSON.stringify({
    principal: { name: 'Test', timezone: 'UTC' },
    daidentity: { name: 'TestAI', voices: { main: { voiceId: 'abcdef1234567890abcdef' } } },
    pai: { version: '5.0.0' },
  }, null, 2));
  for (const sub of ['skills', 'MEMORY', 'MEMORY/STATE', 'MEMORY/WORK', 'hooks', 'Plans']) {
    mkdirSync(join(s1PaiDir, sub), { recursive: true });
  }
  mkdirSync(join(s1PaiDir, 'skills', 'PAI'), { recursive: true });
  writeFileSync(join(s1PaiDir, 'skills', 'PAI', 'SKILL.md'), '# PAI Core Skill');

  // S2: empty pai dir (no settings.json)
  s2PaiDir = join(tempRoot, 's2-pai');
  mkdirSync(s2PaiDir, { recursive: true });

  // S3: invalid JSON
  s3PaiDir = join(tempRoot, 's3-pai');
  mkdirSync(s3PaiDir, { recursive: true });
  writeFileSync(join(s3PaiDir, 'settings.json'), 'not json {{{');

  // S4: empty settings object
  s4PaiDir = join(tempRoot, 's4-pai');
  mkdirSync(s4PaiDir, { recursive: true });
  writeFileSync(join(s4PaiDir, 'settings.json'), JSON.stringify({}));

  // S5: partial structure
  s5PaiDir = join(tempRoot, 's5-pai');
  mkdirSync(s5PaiDir, { recursive: true });
  writeFileSync(join(s5PaiDir, 'settings.json'), JSON.stringify({
    principal: { name: 'Partial', timezone: 'UTC' },
    daidentity: { name: 'PartialAI' },
    pai: { version: '5.0.0' },
  }));
  mkdirSync(join(s5PaiDir, 'skills'), { recursive: true });
  mkdirSync(join(s5PaiDir, 'MEMORY'), { recursive: true });

  // S6: ElevenLabs key in configDir .env
  s6PaiDir = join(tempRoot, 's6-pai');
  s6ConfigDir = join(tempRoot, 's6-config');
  mkdirSync(s6PaiDir, { recursive: true });
  mkdirSync(s6ConfigDir, { recursive: true });
  writeFileSync(join(s6PaiDir, 'settings.json'), JSON.stringify({
    principal: { name: 'KeyTest' }, daidentity: { name: 'KeyAI' }, pai: { version: '5.0.0' },
  }));
  writeFileSync(join(s6ConfigDir, '.env'), 'ELEVENLABS_API_KEY=test_key_abc123\n');
});

afterAll(() => {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ephemeral */ }
});

function findCheck(checks: Array<{ name: string; passed: boolean; detail: string; critical: boolean }>, name: string) {
  return checks.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
}

// ─── Section 1: runValidation with valid settings.json ──────────────────────

describe('Installer Engine — runValidation() with valid settings.json', () => {
  test('settings.json check passes for valid JSON file', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'settings.json');
    expect(c).toBeDefined();
    expect(c!.passed).toBe(true);
    expect(c!.detail).toContain('Valid');
  }, SLOW_TIMEOUT);

  test('principal name check passes when configured', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'Principal name');
    expect(c!.passed).toBe(true);
    expect(c!.detail).toContain('Test');
  }, SLOW_TIMEOUT);

  test('AI identity check passes when configured', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'AI identity');
    expect(c!.passed).toBe(true);
    expect(c!.detail).toContain('TestAI');
  }, SLOW_TIMEOUT);

  test('PAI version check passes when set', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'PAI version');
    expect(c!.passed).toBe(true);
    expect(c!.detail).toContain('5.0.0');
  }, SLOW_TIMEOUT);

  test('directory structure checks pass for all created directories', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    for (const dirName of ['Skills directory', 'Memory directory', 'State directory', 'Work directory', 'Hooks directory', 'Plans directory']) {
      const c = findCheck(checks, dirName);
      expect(c).toBeDefined();
      expect(c!.passed).toBe(true);
      expect(c!.detail).toContain('Present');
    }
  }, SLOW_TIMEOUT);

  test('PAI core skill check passes when SKILL.md exists', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'PAI core skill');
    expect(c!.passed).toBe(true);
    expect(c!.detail).toContain('Present');
  }, SLOW_TIMEOUT);

  test('DA voice ID check passes when voiceId is in settings', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'DA voice ID');
    expect(c!.passed).toBe(true);
    expect(c!.detail).toContain('Voice ID');
  }, SLOW_TIMEOUT);
});

// ─── Section 2: runValidation with missing settings.json ────────────────────

describe('Installer Engine — runValidation() with missing settings.json', () => {
  test('settings.json check fails with "not found"', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s2PaiDir }));
    const c = findCheck(checks, 'settings.json');
    expect(c!.passed).toBe(false);
    expect(c!.detail.toLowerCase()).toContain('not found');
  }, SLOW_TIMEOUT);

  test('settings.json check is marked critical', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s2PaiDir }));
    expect(findCheck(checks, 'settings.json')!.critical).toBe(true);
  }, SLOW_TIMEOUT);
});

// ─── Section 3: runValidation with invalid JSON ─────────────────────────────

describe('Installer Engine — runValidation() with invalid JSON', () => {
  test('settings.json check fails with "invalid JSON" detail', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s3PaiDir }));
    const c = findCheck(checks, 'settings.json');
    expect(c!.passed).toBe(false);
    expect(c!.detail.toLowerCase()).toContain('invalid json');
  }, SLOW_TIMEOUT);
});

// ─── Section 4: runValidation with missing fields ───────────────────────────

describe('Installer Engine — runValidation() with missing fields', () => {
  test('principal name check fails for empty settings', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s4PaiDir }));
    expect(findCheck(checks, 'settings.json')!.passed).toBe(true);
    const c = findCheck(checks, 'Principal name');
    expect(c!.passed).toBe(false);
    expect(c!.detail.toLowerCase()).toContain('not configured');
  }, SLOW_TIMEOUT);

  test('AI identity check fails for empty settings', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s4PaiDir }));
    const c = findCheck(checks, 'AI identity');
    expect(c!.passed).toBe(false);
    expect(c!.detail.toLowerCase()).toContain('not configured');
  }, SLOW_TIMEOUT);

  test('PAI version check fails for empty settings', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s4PaiDir }));
    expect(findCheck(checks, 'PAI version')!.passed).toBe(false);
  }, SLOW_TIMEOUT);
});

// ─── Section 5: directory checks (partial structure) ────────────────────────

describe('Installer Engine — runValidation() directory checks (partial)', () => {
  test('present directories pass (skills, MEMORY)', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s5PaiDir }));
    expect(findCheck(checks, 'Skills directory')!.passed).toBe(true);
    expect(findCheck(checks, 'Memory directory')!.passed).toBe(true);
  }, SLOW_TIMEOUT);

  test('missing directories fail (State, Work, Hooks, Plans)', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s5PaiDir }));
    for (const name of ['State directory', 'Work directory', 'Hooks directory', 'Plans directory']) {
      const c = findCheck(checks, name);
      expect(c!.passed).toBe(false);
      expect(c!.detail).toContain('Missing');
    }
  }, SLOW_TIMEOUT);

  test('skills and MEMORY directories are marked critical', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s5PaiDir }));
    expect(findCheck(checks, 'Skills directory')!.critical).toBe(true);
    expect(findCheck(checks, 'Memory directory')!.critical).toBe(true);
    expect(findCheck(checks, 'Hooks directory')!.critical).toBe(false);
  }, SLOW_TIMEOUT);
});

// ─── Section 6: ElevenLabs key detection ────────────────────────────────────

describe('Installer Engine — runValidation() ElevenLabs key detection', () => {
  test('ElevenLabs check passes when .env has key in configDir', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s6PaiDir, configDir: s6ConfigDir }));
    const c = findCheck(checks, 'ElevenLabs');
    expect(c!.passed).toBe(true);
    expect(c!.detail.toLowerCase()).toContain('stored');
  }, SLOW_TIMEOUT);

  test('ElevenLabs check fails when no .env in configDir/paiDir (and no home ~/.env key)', async () => {
    // PORT-NOTE: v5.0.0 validate.ts also probes `${homedir()}/.env` as a
    // fallback location. On a developer machine whose real ~/.env contains
    // ELEVENLABS_API_KEY=, the check legitimately PASSES even with empty test
    // dirs. The assertion is gated on that real fallback so it stays correct
    // in clean CI (no ~/.env key → fails as expected) and on dev boxes.
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const noEnvConfig = join(tempRoot, 's6-noenv-config');
    mkdirSync(noEnvConfig, { recursive: true });
    const checks = await result.module.runValidation(buildState({ paiDir: s2PaiDir, configDir: noEnvConfig }));

    const homeEnv = join(require('os').homedir(), '.env');
    const homeEnvHasKey =
      require('fs').existsSync(homeEnv) &&
      /ELEVENLABS_API_KEY=\S/.test(require('fs').readFileSync(homeEnv, 'utf-8'));

    const c = findCheck(checks, 'ElevenLabs');
    expect(c).toBeDefined();
    if (homeEnvHasKey) {
      // Real ~/.env has the key — validate.ts's home fallback correctly passes.
      expect(c!.passed).toBe(true);
    } else {
      expect(c!.passed).toBe(false);
    }
  }, SLOW_TIMEOUT);

  test('ElevenLabs check is not critical', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s6PaiDir, configDir: s6ConfigDir }));
    expect(findCheck(checks, 'ElevenLabs')!.critical).toBe(false);
  }, SLOW_TIMEOUT);
});

// ─── Section 7: Pulse health check (replaces v3.0 "Voice server") ───────────

describe('Installer Engine — runValidation() Pulse health check', () => {
  test('Pulse check exists and fails gracefully when Pulse not running', async () => {
    // PORT-NOTE: v3.0 check name was "Voice server" → "Not reachable".
    // v5.0.0 absorbed voice into Pulse: "Pulse (voice + dashboard)".
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    const c = findCheck(checks, 'Pulse');
    expect(c).toBeDefined();
    if (!c!.passed) {
      expect(c!.detail.toLowerCase()).toContain('not reachable');
    }
  }, SLOW_TIMEOUT);

  test('Pulse check is not critical', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const checks = await result.module.runValidation(buildState({ paiDir: s1PaiDir, configDir: s1ConfigDir }));
    expect(findCheck(checks, 'Pulse')!.critical).toBe(false);
  }, SLOW_TIMEOUT);
});

// ─── Section 8: generateSummary() behavior ──────────────────────────────────

describe('Installer Engine — generateSummary() behavior', () => {
  test('voiceMode is "elevenlabs" when elevenLabsKey is present', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const summary = result.module.generateSummary(buildState({
      completedSteps: ['voice'], collected: { elevenLabsKey: 'sk-test-key-123' },
    }));
    expect(summary.voiceMode).toBe('elevenlabs');
  }, SLOW_TIMEOUT);

  test('voiceMode is "macos-say" when voice completed without key', async () => {
    // PORT-NOTE: v3.0 returned a per-OS fallback (windows-sapi on Windows).
    // v5.0.0 dropped the OS branch: it's always "macos-say" without a key.
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const summary = result.module.generateSummary(buildState({
      completedSteps: ['voice'], collected: {},
    }));
    expect(summary.voiceMode).toBe('macos-say');
  }, SLOW_TIMEOUT);

  test('voiceMode is "none" when voice step not completed and no key', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const summary = result.module.generateSummary(buildState({ completedSteps: [], collected: {} }));
    expect(summary.voiceMode).toBe('none');
  }, SLOW_TIMEOUT);

  test('voiceEnabled reflects completedSteps including "voice"', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const withVoice = result.module.generateSummary(buildState({ completedSteps: ['voice'] }));
    const withoutVoice = result.module.generateSummary(buildState({ completedSteps: [] }));
    expect(withVoice.voiceEnabled).toBe(true);
    expect(withoutVoice.voiceEnabled).toBe(false);
  }, SLOW_TIMEOUT);

  test('totalSteps is 9', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    expect(result.module.generateSummary(buildState()).totalSteps).toBe(9);
  }, SLOW_TIMEOUT);

  test('principalName / aiName / timezone come from collected with fallbacks', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const withVals = result.module.generateSummary(buildState({
      collected: { principalName: 'Marcus', aiName: 'Webb', timezone: 'America/Chicago' },
    }));
    const defaults = result.module.generateSummary(buildState({ collected: {} }));
    expect(withVals.principalName).toBe('Marcus');
    expect(withVals.aiName).toBe('Webb');
    expect(withVals.timezone).toBe('America/Chicago');
    expect(defaults.principalName).toBe('User');
    expect(defaults.aiName).toBe('PAI');
    expect(defaults.timezone).toBe('UTC');
  }, SLOW_TIMEOUT);

  test('installType reflects state with "fresh" fallback', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    expect(result.module.generateSummary(buildState({ installType: 'fresh' })).installType).toBe('fresh');
    expect(result.module.generateSummary(buildState({ installType: 'upgrade' })).installType).toBe('upgrade');
    expect(result.module.generateSummary(buildState({ installType: null })).installType).toBe('fresh');
  }, SLOW_TIMEOUT);

  test('completedSteps count matches state', async () => {
    const result = await safeImport<ValidateModule>(`${INSTALL_DIR}/engine/validate`);
    if (!result.ok) return;
    const summary = result.module.generateSummary(buildState({
      completedSteps: ['system-detect', 'prerequisites', 'identity', 'voice'],
    }));
    expect(summary.completedSteps).toBe(4);
  }, SLOW_TIMEOUT);
});

// PORT-NOTE: v3.0 InstallSummary had activationCommand / activationHint with
// platform-specific values ("source ~/.zshrc" vs "pai" / PowerShell hint).
// v5.0.0's InstallSummary type has no such fields (shell-shim activation is
// handled by Bootstrap.bat / install.sh, not surfaced in the summary).
// Ported but skipped — no v5.0.0 analogue.
describe.skip('generateSummary() activationCommand/activationHint (removed in v5.0.0)', () => {
  test('activationCommand is platform-appropriate', () => {
    expect(true).toBe(true);
  });
  test('activationHint is platform-appropriate', () => {
    expect(true).toBe(true);
  });
});
