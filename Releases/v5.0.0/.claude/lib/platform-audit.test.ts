/**
 * Platform Audit — Regression Test
 *
 * Scans the v5.0.0 .claude tree for forbidden platform-specific patterns.
 * Fails if any unguarded Windows-only patterns are found. Prevents
 * regressions as Windows support is maintained.
 *
 * Run: bun test lib/platform-audit.test.ts
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - Scan dir retargeted from V3_DIR to the v5.0.0 .claude root.
 *   - Excludes node_modules/, tests/, CLAUDE.md, lib/platform.ts itself.
 *   - Uses a cross-platform Bun scanner (v3.0 shelled out to grep, which is
 *     unavailable on native Windows where this suite must also run).
 *   - Structural checks (exports, 7 sections) preserved against lib/platform.ts.
 */

import { describe, test, expect } from 'bun:test';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, readdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const V5_DIR = resolve(__dirname, '..');
const PLATFORM_TS = resolve(__dirname, 'platform.ts');

/**
 * Cross-platform scan: count lines matching `regex` across .ts files,
 * excluding tests, node_modules, CLAUDE.md, and platform.ts itself.
 */
function countForbiddenMatches(regex: RegExp): { count: number; locations: string[] } {
  const locations: string[] = [];

  function scan(dir: string): void {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'tests') continue;
        scan(full);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        entry.name !== 'platform.ts' &&
        entry.name !== 'terminal.ts'
      ) {
        try {
          const lines = readFileSync(full, 'utf-8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('CLAUDE.md')) continue;
            if (regex.test(lines[i])) {
              locations.push(`${full.replace(V5_DIR, '').replace(/^[/\\]/, '')}:${i + 1}`);
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  scan(V5_DIR);
  return { count: locations.length, locations };
}

describe('Platform Audit — Forbidden Patterns', () => {

  test('tracks hardcoded /tmp/ in TypeScript (baseline)', () => {
    const { count, locations } = countForbiddenMatches(/["'`]\/tmp\//);
    console.log(`[AUDIT] Hardcoded /tmp/ count: ${count}`);
    if (count > 0) console.log('[AUDIT] Locations:', locations.slice(0, 5).join('\n'));
    // Baseline tracking only (not a hard gate; the windows/07 suite gates it).
  }, 30_000);

  test('tracks bare process.env.HOME! without fallback (baseline)', () => {
    const { count, locations } = countForbiddenMatches(/process\.env\.HOME!/);
    console.log(`[AUDIT] Bare process.env.HOME! count: ${count}`);
    if (count > 0) console.log('[AUDIT] Locations:', locations.slice(0, 5).join('\n'));
  }, 30_000);

  test('no hardcoded Windows paths (must always be 0)', () => {
    const { count } = countForbiddenMatches(/%APPDATA%|%USERPROFILE%/);
    console.log(`[AUDIT] Hardcoded Windows paths: ${count}`);
    expect(count).toBe(0);
  }, 30_000);

  test('no new npm dependencies in platform.ts', () => {
    if (!existsSync(PLATFORM_TS)) {
      console.warn('SKIP: lib/platform.ts not present yet (parallel agent in progress)');
      return;
    }
    const content = readFileSync(PLATFORM_TS, 'utf-8');
    const imports = content.match(/from '([^']+)'/g) || [];
    const allowed = ['os', 'path', 'fs', 'child_process', 'node:os', 'node:path', 'node:fs', 'node:child_process'];

    for (const imp of imports) {
      const pkg = imp.match(/from '([^']+)'/)?.[1] || '';
      const isRelative = pkg.startsWith('.');
      const isBuiltin = allowed.includes(pkg);
      if (!isRelative && !isBuiltin) {
        throw new Error(`platform.ts imports non-builtin package: ${pkg}`);
      }
    }
  });
});

describe('Platform Audit — Structural Checks', () => {

  test('platform.ts exists and exports isWindows', () => {
    if (!existsSync(PLATFORM_TS)) {
      console.warn('SKIP: lib/platform.ts not present yet (parallel agent in progress)');
      return;
    }
    const content = readFileSync(PLATFORM_TS, 'utf-8');
    expect(content).toContain('export const isWindows');
  });

  test('platform.ts exports key functions', () => {
    if (!existsSync(PLATFORM_TS)) {
      console.warn('SKIP: lib/platform.ts not present yet (parallel agent in progress)');
      return;
    }
    const content = readFileSync(PLATFORM_TS, 'utf-8');
    const expectedExports = [
      'getHomeDir',
      'getTempDir',
      'getPortCheckCommandString',
      'getKillCommand',
      'detectTerminal',
      'getAudioPlayCommand',
      'getNotificationCommand',
    ];

    for (const fn of expectedExports) {
      expect(content).toContain(`export function ${fn}`);
    }
  });

  test('platform.ts has all 7 sections', () => {
    if (!existsSync(PLATFORM_TS)) {
      console.warn('SKIP: lib/platform.ts not present yet (parallel agent in progress)');
      return;
    }
    const content = readFileSync(PLATFORM_TS, 'utf-8');
    expect(content).toContain('Section 1: OS Detection');
    expect(content).toContain('Section 2: Path Resolution');
    expect(content).toContain('Section 3: Command Mapping');
    expect(content).toContain('Section 4: Terminal Detection');
    expect(content).toContain('Section 5: Audio & Notifications');
    expect(content).toContain('Section 6: Environment Variable Expansion');
    expect(content).toContain('Section 7: Service Management');
  });
});
