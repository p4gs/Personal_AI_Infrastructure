/**
 * 16-installer-upgrade.test.ts — Installer Upgrade Configuration Tests (Cross-Platform)
 *
 * Tests configuration generation for upgrade scenarios:
 *   - PROJECTS_DIR behavior
 *   - PAI_DIR derivation from config
 *   - Identity fields map to correct output keys
 *   - Generated config includes context files
 *   - Determinism: same input → identical output structure
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - INSTALL_DIR = PAI/PAI-Install.
 *   - v3.0 normalized projectsDir via path.resolve(). v5.0.0 passes
 *     projectsDir straight through (only included if truthy). The
 *     "resolve()-normalized" assertion is replaced with a pass-through
 *     assertion (and a skipped note documenting the v3.0 behavior).
 *   - env.PAI_DIR = `${config.paiDir}/PAI` (was exact paiDir in v3.0).
 *   - contextFiles still present and references skill files
 *     (skills/PAI/SKILL.md is the first entry in v5.0.0).
 *
 * Run: bun test tests/cross-platform/16-installer-upgrade.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { INSTALL_DIR, SLOW_TIMEOUT } from '../windows/helpers';
import { resolve } from 'path';
import { homedir } from 'os';

type ConfigGenModule = {
  generateSettingsJson: (config: Record<string, any>) => Record<string, any>;
};

const baseConfig = {
  principalName: 'UpgradeTestUser',
  timezone: 'Europe/London',
  aiName: 'UpgradeAI',
  catchphrase: 'Upgrading systems',
  paiDir: resolve(homedir(), '.claude'),
  configDir: resolve(homedir(), '.config', 'PAI'),
};

// ─── Section 1: PROJECTS_DIR Behavior ────────────────────────────────────────

describe('Upgrade Config — PROJECTS_DIR', () => {
  test('projectsDir is passed through to env.PROJECTS_DIR when provided', async () => {
    // PORT-NOTE: v3.0 ran projectsDir through path.resolve(). v5.0.0
    // config-gen passes it straight (only set if truthy). Assert pass-through.
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const config = { ...baseConfig, projectsDir: '/Users/test/code' };
    const settings = result.generateSettingsJson(config);
    expect(settings.env.PROJECTS_DIR).toBe('/Users/test/code');
  }, SLOW_TIMEOUT);

  test('PROJECTS_DIR is omitted when projectsDir is not provided', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const settings = result.generateSettingsJson(baseConfig);
    expect('PROJECTS_DIR' in settings.env).toBe(false);
  }, SLOW_TIMEOUT);

  // PORT-NOTE: v3.0 asserted backslash projectsDir was normalized via
  // path.resolve(). v5.0.0 does not normalize — no analogue. Skipped.
  describe.skip('path.resolve() normalization (v3.0 only — see PORT-NOTE)', () => {
    test('backslash projectsDir resolved via path.resolve()', () => {
      expect(true).toBe(true);
    });
  });
});

// ─── Section 2: PAI_DIR Derivation ───────────────────────────────────────────

describe('Upgrade Config — PAI_DIR derivation', () => {
  test('PAI_DIR = provided paiDir + /PAI', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const customPaiDir = '/custom/path/.claude';
    const config = { ...baseConfig, paiDir: customPaiDir };
    const settings = result.generateSettingsJson(config);
    expect(settings.env.PAI_DIR).toBe(`${customPaiDir}/PAI`);
  }, SLOW_TIMEOUT);
});

// ─── Section 3: Identity Population ──────────────────────────────────────────

describe('Upgrade Config — Identity Population', () => {
  test('principalName maps to principal.name', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const settings = result.generateSettingsJson(baseConfig);
    expect(settings.principal.name).toBe(baseConfig.principalName);
  }, SLOW_TIMEOUT);

  test('aiName maps to daidentity.name', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const settings = result.generateSettingsJson(baseConfig);
    expect(settings.daidentity.name).toBe(baseConfig.aiName);
  }, SLOW_TIMEOUT);

  test('timezone maps to principal.timezone', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const settings = result.generateSettingsJson(baseConfig);
    expect(settings.principal.timezone).toBe(baseConfig.timezone);
  }, SLOW_TIMEOUT);
});

// ─── Section 4: Context Files Section ────────────────────────────────────────

describe('Upgrade Config — Context Files Present', () => {
  test('generated config has a non-empty contextFiles array', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const settings = result.generateSettingsJson(baseConfig);
    expect(Array.isArray(settings.contextFiles)).toBe(true);
    expect(settings.contextFiles.length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  test('contextFiles references skill files', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const settings = result.generateSettingsJson(baseConfig);
    const hasSkillRef = settings.contextFiles.some(
      (f: string) => f.includes('skills/') && f.includes('SKILL.md')
    );
    expect(hasSkillRef).toBe(true);
  }, SLOW_TIMEOUT);
});

// ─── Section 5: Determinism ──────────────────────────────────────────────────

describe('Upgrade Config — Determinism', () => {
  test('calling generateSettingsJson twice with same input produces identical output', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const json1 = JSON.stringify(result.generateSettingsJson(baseConfig), null, 2);
    const json2 = JSON.stringify(result.generateSettingsJson(baseConfig), null, 2);
    expect(json1).toBe(json2);
  }, SLOW_TIMEOUT);

  test('two calls produce objects with identical top-level key sets', async () => {
    const result = await import(`${INSTALL_DIR}/engine/config-gen`) as ConfigGenModule;
    const s1 = result.generateSettingsJson(baseConfig);
    const s2 = result.generateSettingsJson(baseConfig);
    expect(Object.keys(s1).sort()).toEqual(Object.keys(s2).sort());
    expect(Object.keys(s1.env).sort()).toEqual(Object.keys(s2.env).sort());
    expect(Object.keys(s1.principal).sort()).toEqual(Object.keys(s2.principal).sort());
    expect(Object.keys(s1.daidentity).sort()).toEqual(Object.keys(s2.daidentity).sort());
    expect(Object.keys(s1.pai).sort()).toEqual(Object.keys(s2.pai).sort());
  }, SLOW_TIMEOUT);
});
