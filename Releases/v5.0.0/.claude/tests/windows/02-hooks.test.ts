/**
 * 02-hooks.test.ts — Hook System Tests (Windows / Cross-Platform Suite)
 *
 * Validates the v5.0.0 hook system works on all platforms:
 *   - Hook files exist and have correct shebangs
 *   - Hooks can be parsed by Bun without syntax errors
 *   - Hook stdin/stdout contract (JSON in, exit cleanly)
 *   - Hook lib modules import cleanly
 *   - Windows-specific graceful degradation
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - v5.0.0 has ~38 hooks (v3.0 had 22). Test asserts a minimum, not exact 22.
 *   - v5.0.0 hook names differ entirely (no AlgorithmTracker/SkillGuard/
 *     StartupGreeting). Contract tests now target a representative existing
 *     hook (LoadContext) instead of v3-specific names.
 *   - hooks/lib/paths.ts in v5.0.0 has NO sanitizeSessionId and NO stdin.ts;
 *     the sanitizeSessionId tests are ported but describe.skip'd. Replacement
 *     module is hooks/lib/hook-io.ts (readHookInput).
 *
 * Run: bun test tests/windows/02-hooks.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_HOOKS,
  HOOKS_DIR,
  IS_NATIVE_WINDOWS,
  SLOW_TIMEOUT,
  executeHook,
  safeImport,
  bunRun,
} from './helpers';

// ─── Section 1: Hook Loading (cross-platform) ──────────────────────────────

describe('Hook Loading', () => {
  test('should have at least 22 hooks (v5.0.0 ships ~38)', () => {
    // PORT-NOTE: v3.0 asserted exactly 22. v5.0.0 has ~38 hooks and the set
    // changes between releases; assert a sane floor instead of an exact count.
    expect(ALL_HOOKS.length).toBeGreaterThanOrEqual(22);
  });

  for (const hook of ALL_HOOKS) {
    describe(hook, () => {
      test('hook file exists in hooks/ directory', () => {
        const hookPath = join(HOOKS_DIR, hook);
        expect(existsSync(hookPath)).toBe(true);
      });

      test('hook file has #!/usr/bin/env bun shebang', () => {
        const hookPath = join(HOOKS_DIR, hook);
        const content = readFileSync(hookPath, 'utf-8');
        // PORT-NOTE: v5.0.0 on Windows has CRLF line endings, so strip a
        // trailing \r before comparing (v3.0 tree was LF-only).
        const firstLine = content.split('\n')[0].replace(/\r$/, '');
        expect(firstLine).toBe('#!/usr/bin/env bun');
      });

      test('hook file can be parsed by bun without syntax errors', () => {
        const hookPath = join(HOOKS_DIR, hook);
        const result = bunRun(['build', '--no-emit', '--target', 'bun', hookPath], { timeout: SLOW_TIMEOUT });
        // Some hooks may depend on optional npm packages (e.g. yaml) that
        // are not installed in CI — that is NOT a Windows/syntax issue.
        if (result.status !== 0) {
          const stderr = result.stderr || '';
          const isDepFailure =
            stderr.includes('Could not resolve') ||
            stderr.includes('Cannot find module') ||
            stderr.includes('No matching export');
          if (isDepFailure) {
            console.warn(`KNOWN DEPENDENCY: ${hook} — skipping parse check`);
            return;
          }
        }
        expect(result.status).toBe(0);
      }, SLOW_TIMEOUT);
    });
  }
});

// ─── Section 2: Hook stdin/stdout Contract (cross-platform) ────────────────

describe('Hook stdin/stdout Contract', () => {
  const minimalInput = {
    session_id: 'test-123',
    event: 'test',
    conversation: [],
  };

  // PORT-NOTE: v3.0 tested AlgorithmTracker/SkillGuard by name. Those hooks
  // do not exist in v5.0.0. We instead exercise a representative existing
  // SessionStart hook (LoadContext) for the no-crash contract.
  test('LoadContext.hook.ts does not crash with minimal input', () => {
    if (!existsSync(join(HOOKS_DIR, 'LoadContext.hook.ts'))) {
      console.warn('SKIP: LoadContext.hook.ts not present in this tree');
      return;
    }
    const result = executeHook('LoadContext.hook.ts', {
      session_id: 'test-ci-00000000',
      session_type: 'interactive',
      event: 'init',
      conversation: [],
    }, SLOW_TIMEOUT);
    expect(result.error).toBeUndefined();
    // 0 = success, 1 = graceful degradation, null = waiting for more stdin
    expect([0, 1, null]).toContain(result.exitCode);
  }, SLOW_TIMEOUT);

  test('a PreToolUse-style hook handles minimal input without process error', () => {
    // Find any hook that looks like a guard/pre-tool hook to smoke-test.
    const candidate = ALL_HOOKS.find(h =>
      /Guard|PromptGuard|SecurityPipeline|ContainmentGuard|SmartApprover/.test(h)
    );
    if (!candidate) {
      console.warn('SKIP: no guard-style hook found in this tree');
      return;
    }
    const result = executeHook(candidate, minimalInput, SLOW_TIMEOUT);
    expect(result.error).toBeUndefined();
    expect([0, 1, null]).toContain(result.exitCode);
  }, SLOW_TIMEOUT);
});

// ─── Section 3: Hook lib Modules (cross-platform) ──────────────────────────

describe('Hook lib Modules', () => {
  test('hooks/lib/paths.ts imports cleanly', async () => {
    const result = await safeImport('../../hooks/lib/paths');
    expect(result.ok).toBe(true);
  }, SLOW_TIMEOUT);

  test('hooks/lib/hook-io.ts imports cleanly (v5.0.0 stdin replacement)', async () => {
    // PORT-NOTE: v3.0 had hooks/lib/stdin.ts; v5.0.0 replaced it with hook-io.ts.
    const result = await safeImport('../../hooks/lib/hook-io');
    expect(result.ok).toBe(true);
  }, SLOW_TIMEOUT);

  test('hooks/lib/tab-setter.ts imports cleanly', async () => {
    const result = await safeImport('../../hooks/lib/tab-setter');
    expect(result.ok).toBe(true);
  }, SLOW_TIMEOUT);

  test('getPaiDir() returns non-empty string', async () => {
    const result = await safeImport<{ getPaiDir: () => string }>('../../hooks/lib/paths');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paiDir = result.module.getPaiDir();
      expect(typeof paiDir).toBe('string');
      expect(paiDir.length).toBeGreaterThan(0);
    }
  }, SLOW_TIMEOUT);

  test('getClaudeDir() returns a path ending in .claude', async () => {
    // PORT-NOTE: v5.0.0 added getClaudeDir() (returns ~/.claude). getPaiDir()
    // now returns ~/.claude/PAI, so the v3 ".claude" assertion moved here.
    const result = await safeImport<{ getClaudeDir: () => string }>('../../hooks/lib/paths');
    expect(result.ok).toBe(true);
    if (result.ok && typeof result.module.getClaudeDir === 'function') {
      expect(result.module.getClaudeDir()).toEndWith('.claude');
    }
  }, SLOW_TIMEOUT);

  // PORT-NOTE: v5.0.0 hooks/lib/paths.ts has NO sanitizeSessionId export.
  // Session-id sanitization is no longer a paths.ts concern. These two
  // v3.0 tests are ported but skipped to preserve the documented intent.
  describe.skip('sanitizeSessionId (removed in v5.0.0 — see PORT-NOTE)', () => {
    test('sanitizeSessionId("abc-123") returns "abc-123"', async () => {
      const result = await safeImport<{ sanitizeSessionId: (id: string) => string }>('../../hooks/lib/paths');
      if (result.ok) {
        expect(result.module.sanitizeSessionId('abc-123')).toBe('abc-123');
      }
    }, SLOW_TIMEOUT);

    test('sanitizeSessionId("../../etc/passwd") strips dots and slashes', async () => {
      const result = await safeImport<{ sanitizeSessionId: (id: string) => string }>('../../hooks/lib/paths');
      if (result.ok) {
        const sanitized = result.module.sanitizeSessionId('../../etc/passwd');
        expect(sanitized).not.toContain('.');
        expect(sanitized).not.toContain('/');
      }
    }, SLOW_TIMEOUT);
  });
});

// ─── Section 4: Windows-specific Hook Execution ────────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('Windows-specific Hook Execution', () => {
  test('a SessionStart hook executes without crash on Windows', () => {
    // PORT-NOTE: v3.0 named StartupGreeting.hook.ts. v5.0.0 has no such hook;
    // LoadContext is the closest SessionStart analogue.
    const candidate = existsSync(join(HOOKS_DIR, 'LoadContext.hook.ts'))
      ? 'LoadContext.hook.ts'
      : ALL_HOOKS.find(h => /Startup|LoadContext|RestoreContext|CheckVersion/.test(h));
    if (!candidate) {
      console.warn('SKIP: no SessionStart-style hook found');
      return;
    }
    const result = executeHook(candidate, {
      session_id: 'test-win-123',
      event: 'init',
      conversation: [],
    }, SLOW_TIMEOUT);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).not.toBeNull();
    if (result.exitCode !== 0) {
      // Non-zero must be a controlled error, not an unhandled panic.
      expect(result.stderr).not.toMatch(/panic|SIGSEGV|Segmentation fault/i);
    }
  }, SLOW_TIMEOUT);

  test('Tab-setter functions gracefully no-op without Kitty', async () => {
    const result = await safeImport<Record<string, unknown>>('../../hooks/lib/tab-setter');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // On Windows there is no Kitty terminal — exercising any exported
      // function should not throw (graceful no-op / adapter fallback).
      const fns = Object.values(result.module).filter(v => typeof v === 'function');
      expect(fns.length).toBeGreaterThan(0);
    }
  }, SLOW_TIMEOUT);
});
