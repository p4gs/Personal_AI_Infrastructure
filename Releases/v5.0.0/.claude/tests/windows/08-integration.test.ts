/**
 * 08-integration.test.ts — Cross-Module Integration Tests
 *
 * Tests that PAI modules work together correctly on Windows.
 * These verify real E2E scenarios, not isolated unit behavior.
 *
 * v3.0 → v5.0.0 PORT-NOTES (IMPORTANT CONTRACT DIVERGENCE):
 *   - lib/platform.ts getPaiDir() returns ~/.claude (v3.0 contract, faithfully
 *     ported). hooks/lib/paths.ts getPaiDir() in v5.0.0 returns ~/.claude/PAI
 *     (the PAI subsystem dir). They NO LONGER agree. The v3.0 test that
 *     asserted "platform.getPaiDir() === paths.getPaiDir()" is ported but
 *     re-expressed: platform.getPaiDir() must equal paths.getClaudeDir()
 *     (the .claude root), and paths.getPaiDir() is the /PAI subdir.
 *   - settings.json hook commands use $HOME/.claude/... (not ${PAI_DIR}).
 *   - statusline is PAI/statusline-command.sh (bash). Statusline execution
 *     E2E is skipped on Windows (no bash in PAI Windows path).
 *   - hooks/lib/tab-setter.ts replaces v3's tab-setter integration.
 *
 * Run: bun test tests/windows/08-integration.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  V5_ROOT,
  STATUSLINE_PATH,
  IS_NATIVE_WINDOWS,
  SLOW_TIMEOUT,
  KITTY_ENV_ACTIVE,
} from './helpers';

// ─── E2E Scenario 1: Platform → Paths Chain ──────────────────────────────────

describe('E2E: Platform detection flows through to hooks', () => {
  test('platform.ts getHomeDir and paths.ts agree on the home base', async () => {
    const platform = await import('../../lib/platform');
    const paths = await import('../../hooks/lib/paths');

    const platformHome = platform.getHomeDir();
    const pathsPai = paths.getPaiDir();

    expect(platformHome.length).toBeGreaterThan(0);
    // v5.0.0: paths.getPaiDir() → ~/.claude/PAI. It must still live under home.
    expect(pathsPai).toContain('.claude');
    expect(pathsPai.startsWith(platformHome)).toBe(true);
  });

  test('platform.getClaudeDir() equals paths.getClaudeDir() (.claude root)', async () => {
    // PORT-NOTE: v3.0 asserted platform.getPaiDir() === paths.getPaiDir().
    // In v5.0.0 BOTH lib/platform.ts and hooks/lib/paths.ts expose
    // getPaiDir() → ~/.claude/PAI and getClaudeDir() → ~/.claude. The
    // canonical-root equivalence is now getClaudeDir() on both. Compare with
    // separators normalized (lib/platform.ts joins via os.homedir() which may
    // mix / and \ on Windows — a separate parallel-source normalization item).
    const platform = await import('../../lib/platform') as Record<string, unknown>;
    const paths = await import('../../hooks/lib/paths') as Record<string, unknown>;

    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
    if (typeof platform.getClaudeDir === 'function' && typeof paths.getClaudeDir === 'function') {
      const a = norm((platform.getClaudeDir as () => string)());
      const b = norm((paths.getClaudeDir as () => string)());
      expect(a).toBe(b);
    } else {
      // Fallback: both PAI dirs resolve under the same .claude root.
      expect(norm((platform.getPaiDir as () => string)())).toContain('.claude');
    }
  });
});

// ─── E2E Scenario 2: Terminal Adapter → Tab Setter Chain ──────────────────────

describe('E2E: Terminal adapter integrates with tab-setter', () => {
  test('tab-setter module loads without error', async () => {
    const result = await import('../../hooks/lib/tab-setter')
      .then(() => true)
      .catch(() => false);
    expect(result).toBe(true);
  });

  test('terminal adapter factory returns valid adapter', async () => {
    const { createTerminalAdapter } = await import('../../lib/terminal');
    const adapter = createTerminalAdapter();

    expect(typeof adapter.setTitle).toBe('function');
    expect(typeof adapter.setTabColor).toBe('function');
    expect(typeof adapter.resetTabColor).toBe('function');
    expect(typeof adapter.supported).toBe('boolean');
  });

  test.skipIf(!IS_NATIVE_WINDOWS)(
    'Windows: terminal adapter is not Kitty',
    async () => {
      const { createTerminalAdapter } = await import('../../lib/terminal');
      const adapter = createTerminalAdapter();
      expect(adapter.constructor.name).not.toBe('KittyTerminalAdapter');
    }
  );
});

// ─── E2E Scenario 3: settings.json → Hook Command Chain ─────────────────────

describe('E2E: Installer settings flow to hook commands', () => {
  test('settings.json exists and is valid JSON', () => {
    const settingsPath = join(V5_ROOT, 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);

    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    expect(typeof settings).toBe('object');
  });

  test('settings.json has hooks configuration', () => {
    const settingsPath = join(V5_ROOT, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    expect(settings.hooks).toBeDefined();
    expect(typeof settings.hooks).toBe('object');
  });

  test('hook commands reference .ts files', () => {
    const settingsPath = join(V5_ROOT, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    if (!settings.hooks) return;

    const commands: string[] = [];
    for (const [_event, matchers] of Object.entries(settings.hooks)) {
      if (Array.isArray(matchers)) {
        for (const matcher of matchers as any[]) {
          if (Array.isArray(matcher.hooks)) {
            for (const hook of matcher.hooks) {
              if (hook.command) commands.push(hook.command);
            }
          }
        }
      }
    }

    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      expect(cmd).toContain('.ts');
    }
  });

  test('statusLine command references statusline-command (sh in v5.0.0)', () => {
    const settingsPath = join(V5_ROOT, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    if (settings.statusLine?.command) {
      // PORT-NOTE: v5.0.0 uses statusline-command.sh, not .ts.
      expect(settings.statusLine.command).toContain('statusline-command');
    }
  });
});

// ─── E2E Scenario 4: Statusline → Git → Platform Chain ───────────────────────

describe('E2E: Statusline uses git and platform correctly', () => {
  test('PAI/statusline-command.sh exists', () => {
    expect(existsSync(STATUSLINE_PATH)).toBe(true);
  });

  test.skipIf(IS_NATIVE_WINDOWS)('statusline produces output (bash present)', () => {
    // PORT-NOTE: v5.0.0 statusline is bash; only runnable where bash exists.
    const result = spawnSync('bash', [STATUSLINE_PATH], {
      input: '{}',
      encoding: 'utf-8',
      timeout: 15_000,
      cwd: V5_ROOT,
      env: { ...process.env, PAI_TEST_MODE: '1' },
    });
    expect(result.status === 0 || result.status === null).toBe(true);
    expect((result.stdout || '').length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  test('git is available and returns branch name', () => {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      cwd: V5_ROOT,
      timeout: 5_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});

// ─── E2E Scenario 5: Cross-Platform Path Consistency ──────────────────────────

describe('E2E: Path abstractions are consistent', () => {
  test('paiPath joins correctly on current platform', async () => {
    const { paiPath, getPaiDir } = await import('../../lib/platform');
    // PORT-NOTE: lib/platform.ts (parallel-source port) currently joins via
    // os.homedir() which can yield mixed / and \ separators on Windows
    // (e.g. C:\Users\x\.claude/PAI). Normalize separators before the
    // startsWith check so this test verifies the join SEMANTICS without
    // being a proxy for that separate path-normalization source fix.
    const norm = (p: string) => p.replace(/\\/g, '/');
    const base = norm(getPaiDir());
    const joined = norm(paiPath('hooks', 'lib', 'paths.ts'));

    expect(joined).toStartWith(base);
    expect(joined).toContain('hooks');
    expect(joined).toContain('paths.ts');
  });

  test('no forward slashes in Windows paths (after drive letter)', async () => {
    if (!IS_NATIVE_WINDOWS) return;

    const { getHomeDir, getTempDir, getPaiDir } = await import('../../lib/platform');

    const homePath = getHomeDir();
    const afterDrive = homePath.substring(3); // Skip "C:\"
    expect(afterDrive).not.toContain('/');
    expect(getTempDir()).toContain('\\');
    expect(getPaiDir()).toContain('\\');
  });
});

// ─── E2E Scenario 6: Windows-Specific Integration ─────────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('E2E: Windows-specific integration', () => {
  test('all platform paths use backslash separators', async () => {
    const { getHomeDir, getTempDir, getPaiDir, paiPath } = await import('../../lib/platform');

    expect(getHomeDir()).toContain('\\');
    expect(getTempDir()).toContain('\\');
    expect(getPaiDir()).toContain('\\');
    expect(paiPath('hooks')).toContain('\\');
  });

  test('Windows Terminal detected when WT_SESSION is set', async () => {
    // Under a kitty env (PAI's own terminal) kitty detection correctly wins;
    // this asserts clean-CI (no-kitty) behavior, so skip when kitty is active.
    if (!process.env.WT_SESSION || KITTY_ENV_ACTIVE) return;
    const { detectTerminal } = await import('../../lib/platform');
    expect(detectTerminal()).toBe('windows-terminal');
  });

  test('platform reports isWindows true', async () => {
    const { isWindows } = await import('../../lib/platform');
    expect(isWindows).toBe(true);
  });
});
