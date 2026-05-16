/**
 * 17-settings-integrity.test.ts — Settings.json Integrity Tests (Cross-Platform)
 *
 * Validates the TEMPLATE settings.json (at Releases/v5.0.0/.claude/settings.json)
 * is internally consistent with the filesystem.
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - Hook commands use `$HOME/.claude/...` (and `bun $HOME/...`), NOT
 *     `${PAI_DIR}/...`. The "must use ${PAI_DIR}" assertion is replaced with
 *     "must use $HOME/$PAI_DIR var, no hardcoded absolute path".
 *   - settings.json `contextFiles` is an EMPTY array in the v5.0.0 template
 *     (it's populated at install time by config-gen). The v3.0 "contextFiles
 *     non-empty + each file exists" test is ported but describe.skip'd with a
 *     PORT-NOTE; config-gen contextFiles output is already covered by test 16.
 *   - statusLine.command points at PAI/statusline-command.sh (bash).
 *   - daidentity has name/displayName/color/voices; principal has name/timezone;
 *     pai.version is "5.0.0".
 *
 * Run: bun test tests/cross-platform/17-settings-integrity.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { V5_ROOT, HOOKS_DIR, ALL_HOOKS } from '../windows/helpers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SETTINGS_PATH = join(V5_ROOT, 'settings.json');
let settings: Record<string, any> | null = null;
let settingsParseError: string | null = null;

try {
  settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
} catch (err: any) {
  settingsParseError = err.message || String(err);
}

function extractHookCommands(settingsObj: Record<string, any>): string[] {
  const commands: string[] = [];
  const hooks = settingsObj.hooks;
  if (!hooks || typeof hooks !== 'object') return commands;
  for (const eventName of Object.keys(hooks)) {
    const eventEntries = hooks[eventName];
    if (!Array.isArray(eventEntries)) continue;
    for (const entry of eventEntries) {
      const hooksList = entry.hooks;
      if (!Array.isArray(hooksList)) continue;
      for (const hook of hooksList) {
        if (hook.command && typeof hook.command === 'string') {
          commands.push(hook.command);
        }
      }
    }
  }
  return commands;
}

function extractHookFilename(command: string): string | null {
  const match = command.match(/hooks[/\\]([A-Za-z0-9_-]+\.hook\.ts)/);
  return match ? match[1] : null;
}

// ─── Section 1: settings.json Exists and Parses ──────────────────────────────

describe('Settings Integrity — File Validity', () => {
  test('settings.json exists and is valid JSON', () => {
    expect(existsSync(SETTINGS_PATH)).toBe(true);
    expect(settingsParseError).toBeNull();
    expect(settings).not.toBeNull();
    expect(typeof settings).toBe('object');
  });
});

// ─── Section 2: Hook Commands Reference Existing Files ───────────────────────

describe('Settings Integrity — Hook File References', () => {
  test('every hook command references an existing file in hooks/', () => {
    if (!settings) return;
    const commands = extractHookCommands(settings);
    expect(commands.length).toBeGreaterThan(0);

    const missingFiles: string[] = [];
    for (const cmd of commands) {
      const filename = extractHookFilename(cmd);
      if (!filename) continue;
      if (!existsSync(join(HOOKS_DIR, filename))) {
        missingFiles.push(`${filename} (from: ${cmd})`);
      }
    }
    if (missingFiles.length > 0) console.error('Missing hook files:', missingFiles);
    expect(missingFiles.length).toBe(0);
  });
});

// ─── Section 3: Hook Commands Use $HOME / $PAI_DIR (no hardcoded paths) ──────

describe('Settings Integrity — Hook Command Patterns', () => {
  test('hook commands use $HOME / ${PAI_DIR} var, no hardcoded absolute paths', () => {
    // PORT-NOTE: v3.0 required ${PAI_DIR}. v5.0.0 uses $HOME/.claude/... .
    if (!settings) return;
    const commands = extractHookCommands(settings);
    expect(commands.length).toBeGreaterThan(0);

    const hardcoded: string[] = [];
    for (const cmd of commands) {
      const usesVar = cmd.includes('$HOME') || cmd.includes('${PAI_DIR}') || cmd.includes('$PAI_DIR');
      // Hardcoded absolute Unix path not using a var:
      if (/(?:^|\s)\/[a-z]/.test(cmd) && !usesVar) hardcoded.push(cmd);
      // Hardcoded Windows path:
      if (/(?:^|\s)[A-Z]:\\/.test(cmd)) hardcoded.push(cmd);
    }
    if (hardcoded.length > 0) console.error('Hook commands with hardcoded paths:', hardcoded);
    expect(hardcoded.length).toBe(0);
  });
});

// ─── Section 4: statusLine Command References Existing File ──────────────────

describe('Settings Integrity — StatusLine', () => {
  test('statusLine command references an existing statusline file', () => {
    if (!settings) return;
    const statusLine = settings.statusLine;
    expect(statusLine).toBeDefined();
    expect(typeof statusLine.command).toBe('string');
    // PORT-NOTE: v5.0.0 → PAI/statusline-command.sh (was .ts in v3.0).
    const command: string = statusLine.command;
    expect(command).toContain('statusline-command');
    // Resolve the referenced file relative to .claude root.
    const rel = command.replace(/^\$HOME\/\.claude\//, '').replace(/^\$\{?PAI_DIR\}?\//, 'PAI/');
    const full = join(V5_ROOT, rel);
    expect(existsSync(full)).toBe(true);
  });
});

// ─── Section 5: contextFiles (empty in v5.0.0 template — see PORT-NOTE) ──────

// PORT-NOTE: v3.0 settings.json template embedded a populated contextFiles
// array and the test asserted every entry existed on disk. In v5.0.0 the
// template ships contextFiles: [] (populated by config-gen at install time).
// config-gen's contextFiles output is covered by test 16. The on-disk
// existence assertion has no template analogue, so it is ported but skipped.
describe.skip('Settings Integrity — Context Files (empty in v5.0.0 template)', () => {
  test('each contextFiles entry has a corresponding file', () => {
    expect(true).toBe(true);
  });
});

// ─── Section 6: env Section Has Required Keys ────────────────────────────────

describe('Settings Integrity — env Section', () => {
  test('env section has PAI_DIR and PAI_CONFIG_DIR', () => {
    if (!settings) return;
    expect(typeof settings.env).toBe('object');
    expect(typeof settings.env.PAI_DIR).toBe('string');
    expect(typeof settings.env.PAI_CONFIG_DIR).toBe('string');
  });
});

// ─── Section 7: daidentity Section Has Required Keys ─────────────────────────

describe('Settings Integrity — daidentity Section', () => {
  test('daidentity has name, displayName, color, and voices', () => {
    if (!settings) return;
    const da = settings.daidentity;
    expect(typeof da).toBe('object');
    expect(typeof da.name).toBe('string');
    expect(typeof da.displayName).toBe('string');
    expect(typeof da.color).toBe('string');
    expect(typeof da.voices).toBe('object');
  });
});

// ─── Section 8: principal Section Has Required Keys ──────────────────────────

describe('Settings Integrity — principal Section', () => {
  test('principal has name and timezone', () => {
    if (!settings) return;
    const principal = settings.principal;
    expect(typeof principal).toBe('object');
    expect(typeof principal.name).toBe('string');
    expect(typeof principal.timezone).toBe('string');
  });
});

// ─── Section 9: pai Section Has Version ──────────────────────────────────────

describe('Settings Integrity — pai Section', () => {
  test('pai.version exists and is a string', () => {
    if (!settings) return;
    const pai = settings.pai;
    expect(typeof pai).toBe('object');
    expect(typeof pai.version).toBe('string');
    expect(pai.version.length).toBeGreaterThan(0);
  });
});
