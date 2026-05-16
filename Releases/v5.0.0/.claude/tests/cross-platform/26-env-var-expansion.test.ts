/**
 * 26-env-var-expansion.test.ts — Cross-Platform Environment Variable Expansion
 *
 * Tests expandEnvVars() in lib/platform.ts (${VAR} expansion, %VAR% on
 * Windows, edge cases). lib/platform.ts is the faithful v3.0 port — the
 * expandEnvVars contract is unchanged.
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - Sections 1-4 (basic expansion, edge cases, Windows %VAR%) port verbatim.
 *   - Section 5 validated settings.json hook commands use ${PAI_DIR}. v5.0.0
 *     hook commands use $HOME/.claude/... (and `bun $HOME/...`). The
 *     assertion is adapted: hook commands must use a recognized env var
 *     ($HOME or ${PAI_DIR}/$PAI_DIR), never %VAR% cmd-style. expandEnvVars
 *     still must process every command without leaving an unexpanded
 *     `${...}` token.
 *
 * Run: bun test tests/cross-platform/26-env-var-expansion.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { V5_ROOT, IS_NATIVE_WINDOWS, SLOW_TIMEOUT, safeImport } from '../windows/helpers';

type PlatformModule = { expandEnvVars: (str: string) => string };

let platformMod: PlatformModule | null = null;
async function getPlatform(): Promise<PlatformModule> {
  if (platformMod) return platformMod;
  const result = await safeImport<PlatformModule>('../../lib/platform');
  if (!result.ok) throw new Error(`Failed to import platform.ts: ${result.error}`);
  platformMod = result.module;
  return platformMod;
}

// ─── Section 1: Basic ${VAR} expansion ───────────────────────────────────────

describe('expandEnvVars() — basic expansion', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    savedEnv.PAI_TEST_VAR = process.env.PAI_TEST_VAR;
    process.env.PAI_TEST_VAR = '/test/value';
  });

  afterAll(() => {
    if (savedEnv.PAI_TEST_VAR === undefined) delete process.env.PAI_TEST_VAR;
    else process.env.PAI_TEST_VAR = savedEnv.PAI_TEST_VAR;
  });

  test('expands a known env variable', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('${PAI_TEST_VAR}/hooks/test.ts')).toBe('/test/value/hooks/test.ts');
  }, SLOW_TIMEOUT);

  test('handles string with no variables', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('hello world')).toBe('hello world');
    expect(mod.expandEnvVars('')).toBe('');
    expect(mod.expandEnvVars('/usr/bin/bun')).toBe('/usr/bin/bun');
  }, SLOW_TIMEOUT);

  test('expands multiple variables in one string', async () => {
    const mod = await getPlatform();
    process.env.PAI_TEST_A = 'alpha';
    process.env.PAI_TEST_B = 'beta';
    try {
      expect(mod.expandEnvVars('${PAI_TEST_A}/${PAI_TEST_B}/end')).toBe('alpha/beta/end');
    } finally {
      delete process.env.PAI_TEST_A;
      delete process.env.PAI_TEST_B;
    }
  }, SLOW_TIMEOUT);

  test('undefined variables are replaced with empty string', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('${DEFINITELY_NOT_A_REAL_ENV_VAR_12345}/path')).toBe('/path');
  }, SLOW_TIMEOUT);

  test('handles $VAR without braces (no expansion)', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('$PAI_TEST_VAR/hooks/test.ts')).toBe('$PAI_TEST_VAR/hooks/test.ts');
  }, SLOW_TIMEOUT);
});

// ─── Section 2: PAI hook command patterns ────────────────────────────────────

describe('expandEnvVars() — PAI hook command patterns', () => {
  const savedPaiDir = process.env.PAI_DIR;

  beforeAll(() => {
    process.env.PAI_DIR = IS_NATIVE_WINDOWS
      ? 'C:\\Users\\testuser\\.claude'
      : '/home/testuser/.claude';
  });

  afterAll(() => {
    if (savedPaiDir === undefined) delete process.env.PAI_DIR;
    else process.env.PAI_DIR = savedPaiDir;
  });

  test('expands ${PAI_DIR} in a hook command pattern', async () => {
    const mod = await getPlatform();
    const result = mod.expandEnvVars('bun ${PAI_DIR}/hooks/SecurityPipeline.hook.ts');
    expect(result).toContain('.claude/hooks/SecurityPipeline.hook.ts');
    expect(result).not.toContain('${');
  }, SLOW_TIMEOUT);

  test('$PAI_DIR (no braces) is left unexpanded', async () => {
    const mod = await getPlatform();
    const cmd = 'bun $PAI_DIR/statusline-command.sh';
    expect(mod.expandEnvVars(cmd)).toBe(cmd);
  }, SLOW_TIMEOUT);
});

// ─── Section 3: Edge cases ───────────────────────────────────────────────────

describe('expandEnvVars() — edge cases', () => {
  test('handles adjacent variables', async () => {
    const mod = await getPlatform();
    process.env.PAI_TEST_X = 'foo';
    process.env.PAI_TEST_Y = 'bar';
    try {
      expect(mod.expandEnvVars('${PAI_TEST_X}${PAI_TEST_Y}')).toBe('foobar');
    } finally {
      delete process.env.PAI_TEST_X;
      delete process.env.PAI_TEST_Y;
    }
  }, SLOW_TIMEOUT);

  test('handles empty variable value', async () => {
    const mod = await getPlatform();
    process.env.PAI_TEST_EMPTY = '';
    try {
      expect(mod.expandEnvVars('prefix${PAI_TEST_EMPTY}suffix')).toBe('prefixsuffix');
    } finally {
      delete process.env.PAI_TEST_EMPTY;
    }
  }, SLOW_TIMEOUT);

  test('does not recursively expand', async () => {
    const mod = await getPlatform();
    process.env.PAI_TEST_REC = '${HOME}';
    try {
      expect(mod.expandEnvVars('${PAI_TEST_REC}')).toBe('${HOME}');
    } finally {
      delete process.env.PAI_TEST_REC;
    }
  }, SLOW_TIMEOUT);

  test('handles malformed patterns gracefully', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('${UNCLOSED')).toBe('${UNCLOSED');
    expect(mod.expandEnvVars('${}')).toBe('${}');
    expect(mod.expandEnvVars('${')).toBe('${');
  }, SLOW_TIMEOUT);

  test('preserves escaped dollar signs', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('$$HOME')).toBe('$$HOME');
  }, SLOW_TIMEOUT);
});

// ─── Section 4: Windows %VAR% syntax ─────────────────────────────────────────

describe('expandEnvVars() — Windows %VAR% syntax', () => {
  test.skipIf(!IS_NATIVE_WINDOWS)('expands %USERPROFILE% on Windows', async () => {
    const mod = await getPlatform();
    const result = mod.expandEnvVars('%USERPROFILE%\\.claude');
    expect(result).toContain(process.env.USERPROFILE || '');
    expect(result).not.toContain('%USERPROFILE%');
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('does NOT expand %VAR% on Unix', async () => {
    const mod = await getPlatform();
    expect(mod.expandEnvVars('%HOME%/test')).toBe('%HOME%/test');
  }, SLOW_TIMEOUT);
});

// ─── Section 5: Real settings.json validation (adapted to $HOME) ─────────────

describe('settings.json hook commands expansion', () => {
  function collectCommands(): string[] {
    const settings = JSON.parse(readFileSync(join(V5_ROOT, 'settings.json'), 'utf-8'));
    const commands: string[] = [];
    for (const eventHooks of Object.values(settings.hooks || {})) {
      for (const hookGroup of eventHooks as any[]) {
        for (const hook of (hookGroup.hooks || [hookGroup])) {
          if (hook.command) commands.push(hook.command);
        }
      }
    }
    return commands;
  }

  test('all hook commands use a recognized env var, never %VAR% cmd-style', () => {
    // PORT-NOTE: v3.0 required ${PAI_DIR}. v5.0.0 uses $HOME/.claude/... .
    const commands = collectCommands();
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      const usesVar =
        cmd.includes('$HOME') || cmd.includes('${PAI_DIR}') || cmd.includes('$PAI_DIR');
      expect(usesVar).toBe(true);
      // Claude Code handles ${}/$ uniformly — never Windows %VAR% cmd style.
      expect(cmd).not.toContain('%PAI_DIR%');
      expect(cmd).not.toContain('%HOME%');
    }
  }, SLOW_TIMEOUT);

  test('expandEnvVars can process every hook command without leaving ${...}', async () => {
    const mod = await getPlatform();
    const commands = collectCommands();
    const savedHome = process.env.HOME;
    const savedPaiDir = process.env.PAI_DIR;
    process.env.HOME = process.env.HOME || '/test/home';
    process.env.PAI_DIR = '/test/pai';
    try {
      for (const cmd of commands) {
        const expanded = mod.expandEnvVars(cmd);
        // After expansion no ${...} token should remain.
        expect(expanded).not.toMatch(/\$\{[^}]+\}/);
      }
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedPaiDir === undefined) delete process.env.PAI_DIR;
      else process.env.PAI_DIR = savedPaiDir;
    }
  }, SLOW_TIMEOUT);
});
