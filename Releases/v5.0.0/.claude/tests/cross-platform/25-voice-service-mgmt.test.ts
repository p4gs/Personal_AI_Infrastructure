/**
 * 25-voice-service-mgmt.test.ts — Pulse / Voice Service Management Tests
 *
 * Tests Windows Task Scheduler, macOS launchctl, and Linux service
 * management for the (now Pulse-embedded) voice service.
 *
 * v3.0 → v5.0.0 PORT-NOTES (ARCHITECTURE CHANGE):
 *   v3.0 tested VoiceServer/manage.ts — a TS service manager CLI — by source
 *   analysis (schtasks.exe/launchctl/systemctl strings, function names) and
 *   `bun run manage.ts` help-output behavior.
 *
 *   v5.0.0 has NO manage.ts. Voice is embedded in Pulse; service lifecycle is
 *   PAI/PULSE/manage.sh (a bash script with Windows Task Scheduler / macOS
 *   launchctl / Linux branches). The platform-abstraction tests
 *   (getServiceManager / getLogDir from lib/platform.ts — the faithful v3.0
 *   port) carry over unchanged. The manage source-analysis is retargeted to
 *   PAI/PULSE/manage.sh and asserts the equivalent service-manager wiring.
 *   The `bun run manage.ts` CLI behavior tests have no v5.0.0 analogue and
 *   are ported but describe.skip'd.
 *
 * Run: bun test tests/cross-platform/25-voice-service-mgmt.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  V5_ROOT, IS_NATIVE_WINDOWS, IS_MACOS, IS_LINUX,
  SLOW_TIMEOUT, safeImport,
} from '../windows/helpers';

type PlatformModule = {
  getServiceManager: () => 'launchctl' | 'systemd' | 'task-scheduler' | 'none';
  getLogDir: () => string;
};

let platformMod: PlatformModule | null = null;
async function getPlatform(): Promise<PlatformModule> {
  if (platformMod) return platformMod;
  const result = await safeImport<PlatformModule>('../../lib/platform');
  if (!result.ok) throw new Error(`Failed to import platform.ts: ${result.error}`);
  platformMod = result.module;
  return platformMod;
}

const MANAGE_SH = join(V5_ROOT, 'PAI', 'PULSE', 'manage.sh');

// ─── Section 1: Service Manager Detection (lib/platform.ts) ──────────────────

describe('getServiceManager()', () => {
  test('returns a valid service manager type', async () => {
    expect(['launchctl', 'systemd', 'task-scheduler', 'none'])
      .toContain((await getPlatform()).getServiceManager());
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: returns task-scheduler', async () => {
    expect((await getPlatform()).getServiceManager()).toBe('task-scheduler');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_MACOS)('macOS: returns launchctl', async () => {
    expect((await getPlatform()).getServiceManager()).toBe('launchctl');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_LINUX)('Linux: returns systemd', async () => {
    expect((await getPlatform()).getServiceManager()).toBe('systemd');
  }, SLOW_TIMEOUT);
});

// ─── Section 2: PAI/PULSE/manage.sh service wiring (retargeted) ──────────────

describe('Pulse manage.sh — service management wiring', () => {
  test('PAI/PULSE/manage.sh exists', () => {
    expect(existsSync(MANAGE_SH)).toBe(true);
  });

  const manage = existsSync(MANAGE_SH) ? readFileSync(MANAGE_SH, 'utf-8') : '';

  test('supports start/stop/restart/status/install/uninstall', () => {
    for (const cmd of ['start', 'stop', 'restart', 'status', 'install', 'uninstall']) {
      expect(manage).toContain(cmd);
    }
  });

  test('Windows Task Scheduler integration (schtasks)', () => {
    expect(manage).toContain('schtasks.exe');
    expect(manage).toContain('/Run');
    expect(manage).toContain('/End');
  });

  test('macOS launchctl integration', () => {
    expect(manage).toContain('launchctl load');
    expect(manage).toContain('launchctl unload');
  });
});

// ─── Section 3: Log Path Resolution (lib/platform.ts) ───────────────────────

describe('voice/pulse log paths', () => {
  test('getLogDir returns a non-empty string', async () => {
    const logDir = (await getPlatform()).getLogDir();
    expect(typeof logDir).toBe('string');
    expect(logDir.length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: log dir is under AppData (when set)', async () => {
    const logDir = (await getPlatform()).getLogDir();
    if (process.env.APPDATA) {
      expect(logDir).toContain('PAI');
    }
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_MACOS)('macOS: log dir is Library/Logs', async () => {
    expect((await getPlatform()).getLogDir()).toContain('Library/Logs');
  }, SLOW_TIMEOUT);
});

// PORT-NOTE: v3.0 ran `bun run VoiceServer/manage.ts` and asserted help
// output ("PAI Voice Server Manager", platform name, exit codes for unknown
// commands) and TS function names (installMacOS/installWindows/installLinux/
// installWSL, spawn(bunPath ...)). v5.0.0 has no manage.ts (voice is embedded
// in Pulse; lifecycle is the manage.sh bash script tested above). These TS
// CLI behavior assertions have no v5.0.0 analogue — ported but skipped.
describe.skip('manage.ts CLI behavior (removed in v5.0.0 — see PORT-NOTE)', () => {
  test('shows "PAI Voice Server Manager" help and exits 0', () => {
    expect(true).toBe(true);
  });
  test('exits 1 for unknown command', () => {
    expect(true).toBe(true);
  });
  test('has installMacOS/installWindows/installLinux/installWSL functions', () => {
    expect(true).toBe(true);
  });
});
