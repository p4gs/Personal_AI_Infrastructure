/**
 * 05-process.test.ts — Process Management Abstraction E2E Tests
 *
 * Tests the process management functions from lib/platform.ts
 * against REAL platform behavior. No mocking of process.platform.
 *
 * Ported from PAI v3.0 — lib/platform.ts contract is identical (the parallel
 * platform-port agent faithfully ports v3.0's lib/platform.ts). Only V3_ROOT
 * → V5_ROOT changed.
 *
 * Run: bun test tests/windows/05-process.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync, spawn } from 'child_process';
import {
  V5_ROOT,
  IS_NATIVE_WINDOWS,
  SLOW_TIMEOUT,
} from './helpers';

import {
  getPortCheckCommandString,
  getKillCommand,
  getKillByPatternCommand,
  getDefaultShell,
} from '../../lib/platform';

// ─── 1. Command Generation (cross-platform) ────────────────────────────────

describe('process management — command generation', () => {

  test('getPortCheckCommandString(3000) contains "3000"', () => {
    const cmd = getPortCheckCommandString(3000);
    expect(cmd).toContain('3000');
  });

  test('getPortCheckCommandString(8888) contains "8888"', () => {
    const cmd = getPortCheckCommandString(8888);
    expect(cmd).toContain('8888');
  });

  test('getKillCommand(999, false) contains "999"', () => {
    const cmd = getKillCommand(999, false);
    expect(cmd).toContain('999');
  });

  test('getKillCommand(999, true) contains "999" and implies force', () => {
    const cmd = getKillCommand(999, true);
    expect(cmd).toContain('999');

    const nonForce = getKillCommand(999, false);
    expect(cmd).not.toBe(nonForce);

    if (IS_NATIVE_WINDOWS) {
      expect(cmd).toContain('/F');
    } else {
      expect(cmd).toContain('-9');
    }
  });

  test('getKillByPatternCommand("myprocess") contains "myprocess"', () => {
    const cmd = getKillByPatternCommand('myprocess');
    expect(cmd).toContain('myprocess');
  });

  test('getPortCheckCommandString returns non-empty string for any port', () => {
    const cmd = getPortCheckCommandString(0);
    expect(cmd.length).toBeGreaterThan(0);
  });

  test('getKillCommand returns non-empty string for any PID', () => {
    const cmd = getKillCommand(1, false);
    expect(cmd.length).toBeGreaterThan(0);
  });

  test('getKillByPatternCommand returns non-empty string for any pattern', () => {
    const cmd = getKillByPatternCommand('anything');
    expect(cmd.length).toBeGreaterThan(0);
  });

});

// ─── 2. Windows-Specific Commands (skipIf not win32) ────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('process management — Windows-specific commands', () => {

  test('port check command contains "netstat", "findstr", and "LISTENING"', () => {
    const cmd = getPortCheckCommandString(3000);
    const lower = cmd.toLowerCase();
    expect(lower).toContain('netstat');
    expect(lower).toContain('findstr');
    expect(cmd).toContain('LISTENING');
  });

  test('kill command contains "taskkill"', () => {
    const cmd = getKillCommand(999, false);
    expect(cmd.toLowerCase()).toContain('taskkill');
  });

  test('force kill command contains "/F"', () => {
    const cmd = getKillCommand(999, true);
    expect(cmd).toContain('/F');
  });

  test('kill by pattern contains "taskkill" and "/FI" or the pattern name', () => {
    const cmd = getKillByPatternCommand('myprocess');
    const lower = cmd.toLowerCase();
    expect(lower).toContain('taskkill');
    const hasFI = cmd.includes('/FI');
    const hasPattern = cmd.includes('myprocess');
    expect(hasFI || hasPattern).toBe(true);
  });

  test('getDefaultShell() returns path containing "powershell" (case insensitive)', () => {
    const shell = getDefaultShell();
    expect(shell.toLowerCase()).toContain('powershell');
  });

});

// ─── 3. Unix-Specific Commands (skipIf win32) ──────────────────────────────

describe.skipIf(IS_NATIVE_WINDOWS)('process management — Unix-specific commands', () => {

  test('port check command contains "lsof"', () => {
    const cmd = getPortCheckCommandString(3000);
    expect(cmd).toContain('lsof');
  });

  test('kill command contains "kill"', () => {
    const cmd = getKillCommand(999, false);
    expect(cmd).toContain('kill');
  });

  test('force kill contains "-9"', () => {
    const cmd = getKillCommand(999, true);
    expect(cmd).toContain('-9');
  });

  test('kill by pattern contains "pkill"', () => {
    const cmd = getKillByPatternCommand('myprocess');
    expect(cmd).toContain('pkill');
  });

  test('getDefaultShell() returns a path or shell name (not powershell)', () => {
    const shell = getDefaultShell();
    expect(shell.length).toBeGreaterThan(0);
    expect(shell.toLowerCase()).not.toContain('powershell');
  });

});

// ─── 4. Real Process Operations on Windows (skipIf not win32) ───────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('process management — real process operations (Windows)', () => {

  test('can start a bun HTTP server on a random port, find it with netstat, and kill it', async () => {
    const port = 49152 + Math.floor(Math.random() * 16383);

    const serverScript = `
      const server = Bun.serve({
        port: ${port},
        fetch() { return new Response("ok"); },
      });
      process.stdout.write("LISTENING:" + server.port + "\\n");
      setTimeout(() => { server.stop(); process.exit(0); }, 10000);
    `;

    const server = spawn('bun', ['-e', serverScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: V5_ROOT,
    });

    try {
      const listening = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        server.stdout?.on('data', (data: Buffer) => {
          if (data.toString().includes('LISTENING:')) {
            clearTimeout(timeout);
            resolve(true);
          }
        });
        server.on('error', () => { clearTimeout(timeout); resolve(false); });
        server.on('exit', () => { clearTimeout(timeout); resolve(false); });
      });

      expect(listening).toBe(true);

      const checkCmd = getPortCheckCommandString(port);
      const checkResult = spawnSync('cmd.exe', ['/c', checkCmd], {
        encoding: 'utf-8',
        timeout: 5_000,
      });

      const output = checkResult.stdout || '';
      expect(output).toContain(String(port));
    } finally {
      if (server.pid) {
        try {
          const killCmd = getKillCommand(server.pid, true);
          spawnSync('cmd.exe', ['/c', killCmd], { timeout: 3_000 });
        } catch {
          // Best-effort cleanup
        }
      }
      server.kill();
    }
  }, SLOW_TIMEOUT);

  test('generated port check command runs without crashing', () => {
    const checkCmd = getPortCheckCommandString(1);
    const result = spawnSync('cmd.exe', ['/c', checkCmd], {
      encoding: 'utf-8',
      timeout: 5_000,
    });

    expect(result.status).not.toBeNull();
  });

});

// ─── 5. Signal Handling (cross-platform) ────────────────────────────────────

describe('process management — signal handling', () => {

  test('process.on("SIGINT", handler) does not throw', () => {
    const handler = () => {};
    expect(() => {
      process.on('SIGINT', handler);
    }).not.toThrow();
    process.removeListener('SIGINT', handler);
  });

  test('process.on("SIGTERM", handler) does not throw (even on Windows)', () => {
    const handler = () => {};
    expect(() => {
      process.on('SIGTERM', handler);
    }).not.toThrow();
    process.removeListener('SIGTERM', handler);
  });

  test('registered signal handler is a function', () => {
    const handler = () => {};
    process.on('SIGINT', handler);
    const listeners = process.listeners('SIGINT');
    expect(listeners).toContain(handler);
    process.removeListener('SIGINT', handler);
  });

});
