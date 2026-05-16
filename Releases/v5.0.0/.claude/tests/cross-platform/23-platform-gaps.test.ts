/**
 * 23-platform-gaps.test.ts — Platform.ts Remaining Gap Coverage
 *
 * Tests exported functions/constants from lib/platform.ts NOT covered by
 * tests 01/05/06: getLogDir, isWSL, getKillByPatternCommand,
 * getDeleteFileCommand, getLocalTTSCommand, getPortCheckCommand, getHomeDir,
 * getConfigDir, isKittyAvailable, getKittySocketPath, getTempFilePath,
 * pathSeparator.
 *
 * Ported from PAI v3.0 — lib/platform.ts contract is identical (faithfully
 * ported by the parallel platform-port agent). Only V3_ROOT → V5_ROOT.
 *
 * Run: bun test tests/cross-platform/23-platform-gaps.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { sep } from 'path';
import {
  IS_NATIVE_WINDOWS, IS_MACOS, IS_LINUX,
  SLOW_TIMEOUT, safeImport, isAbsolutePath,
} from '../windows/helpers';

type PlatformModule = {
  getLogDir: () => string;
  isWSL: boolean;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  getKillByPatternCommand: (pattern: string) => string;
  getDeleteFileCommand: (filePath: string) => { command: string; args: string[] };
  getLocalTTSCommand: (text: string, voiceName?: string) => { command: string; args: string[] } | null;
  getPortCheckCommand: (port: number) => { command: string; args: string[] };
  getHomeDir: () => string;
  getConfigDir: () => string;
  isKittyAvailable: () => boolean;
  getKittySocketPath: () => string | null;
  getTempFilePath: (prefix: string, extension: string) => string;
  pathSeparator: string;
  getPlatformName: () => string;
  platform: NodeJS.Platform;
};

let platformMod: PlatformModule | null = null;

async function getPlatform(): Promise<PlatformModule> {
  if (platformMod) return platformMod;
  const result = await safeImport<PlatformModule>('../../lib/platform');
  if (!result.ok) throw new Error(`Failed to import platform.ts: ${result.error}`);
  platformMod = result.module;
  return platformMod;
}

// ─── getLogDir() ─────────────────────────────────────────────────────────────

describe('getLogDir()', () => {
  test('returns a non-empty absolute path', async () => {
    const mod = await getPlatform();
    const logDir = mod.getLogDir();
    expect(typeof logDir).toBe('string');
    expect(logDir.length).toBeGreaterThan(0);
    expect(isAbsolutePath(logDir)).toBe(true);
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_MACOS)('macOS: contains Library/Logs', async () => {
    const mod = await getPlatform();
    expect(mod.getLogDir()).toContain('Library/Logs');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_LINUX)('Linux: contains .local/share path segment', async () => {
    const mod = await getPlatform();
    expect(mod.getLogDir()).toContain('.local/share');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: contains AppData or home directory', async () => {
    const mod = await getPlatform();
    const logDir = mod.getLogDir();
    const home = mod.getHomeDir();
    expect(logDir.includes('AppData') || logDir.startsWith(home)).toBe(true);
  }, SLOW_TIMEOUT);
});

// ─── isWSL ───────────────────────────────────────────────────────────────────

describe('isWSL', () => {
  test('is a boolean', async () => {
    expect(typeof (await getPlatform()).isWSL).toBe('boolean');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows native: isWSL is false', async () => {
    expect((await getPlatform()).isWSL).toBe(false);
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_MACOS)('macOS: isWSL is false', async () => {
    expect((await getPlatform()).isWSL).toBe(false);
  }, SLOW_TIMEOUT);
});

// ─── getKillByPatternCommand() ───────────────────────────────────────────────

describe('getKillByPatternCommand()', () => {
  test('pattern appears in the returned command string', async () => {
    const mod = await getPlatform();
    expect(mod.getKillByPatternCommand('my-test-process')).toContain('my-test-process');
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('Unix: contains pkill', async () => {
    expect((await getPlatform()).getKillByPatternCommand('bun')).toContain('pkill');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: contains taskkill', async () => {
    expect((await getPlatform()).getKillByPatternCommand('bun')).toContain('taskkill');
  }, SLOW_TIMEOUT);
});

// ─── getDeleteFileCommand() ──────────────────────────────────────────────────

describe('getDeleteFileCommand()', () => {
  test('returns { command, args } with file path in args', async () => {
    const mod = await getPlatform();
    const r = mod.getDeleteFileCommand('/tmp/pai-delete-test.txt');
    expect(typeof r.command).toBe('string');
    expect(Array.isArray(r.args)).toBe(true);
    expect(r.args.join(' ')).toContain('/tmp/pai-delete-test.txt');
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('Unix: uses rm command', async () => {
    const r = (await getPlatform()).getDeleteFileCommand('/tmp/test.txt');
    expect(r.command).toBe('rm');
    expect(r.args).toContain('-f');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: uses cmd.exe with del', async () => {
    const r = (await getPlatform()).getDeleteFileCommand('C:\\temp\\test.txt');
    expect(r.command).toBe('cmd.exe');
    expect(r.args).toContain('/c');
    expect(r.args).toContain('del');
  }, SLOW_TIMEOUT);
});

// ─── getLocalTTSCommand() ────────────────────────────────────────────────────

describe('getLocalTTSCommand()', () => {
  test('returns object or null', async () => {
    const r = (await getPlatform()).getLocalTTSCommand('Hello world');
    if (r !== null) {
      expect(typeof r.command).toBe('string');
      expect(Array.isArray(r.args)).toBe(true);
    }
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_MACOS)('macOS: uses /usr/bin/say', async () => {
    const r = (await getPlatform()).getLocalTTSCommand('Test speech');
    expect(r).not.toBeNull();
    if (r) expect(r.command).toBe('/usr/bin/say');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: uses powershell.exe with System.Speech', async () => {
    const r = (await getPlatform()).getLocalTTSCommand('Hello Windows');
    expect(r).not.toBeNull();
    if (r) {
      expect(r.command).toBe('powershell.exe');
      expect(r.args.join(' ')).toContain('System.Speech');
    }
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_LINUX)('Linux: uses espeak command', async () => {
    const r = (await getPlatform()).getLocalTTSCommand('Linux test');
    expect(r).not.toBeNull();
    if (r) expect(r.command).toBe('espeak');
  }, SLOW_TIMEOUT);

  test('sanitizes dangerous characters from text', async () => {
    const r = (await getPlatform()).getLocalTTSCommand('test`$(whoami)\'evil"stuff\\bad');
    if (r !== null) {
      const argsJoined = r.args.join(' ');
      expect(argsJoined).not.toContain('$(');
      expect(argsJoined).not.toContain('`');
    }
  }, SLOW_TIMEOUT);
});

// ─── getPortCheckCommand() ───────────────────────────────────────────────────

describe('getPortCheckCommand()', () => {
  test('returns { command, args } object', async () => {
    const r = (await getPlatform()).getPortCheckCommand(8080);
    expect(typeof r.command).toBe('string');
    expect(Array.isArray(r.args)).toBe(true);
    expect(r.args.length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('Unix: uses lsof', async () => {
    const r = (await getPlatform()).getPortCheckCommand(3000);
    expect(r.command).toBe('lsof');
    expect(r.args.join(' ')).toContain(':3000');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: uses netstat', async () => {
    const r = (await getPlatform()).getPortCheckCommand(8888);
    expect(r.command).toBe('netstat');
    expect(r.args).toContain('-ano');
  }, SLOW_TIMEOUT);
});

// ─── getHomeDir() fallback chain ─────────────────────────────────────────────

describe('getHomeDir()', () => {
  test('returns a non-empty absolute path', async () => {
    const home = (await getPlatform()).getHomeDir();
    expect(home.length).toBeGreaterThan(0);
    expect(isAbsolutePath(home)).toBe(true);
  }, SLOW_TIMEOUT);

  test('result is consistent across multiple calls', async () => {
    const mod = await getPlatform();
    expect(mod.getHomeDir()).toBe(mod.getHomeDir());
  }, SLOW_TIMEOUT);
});

// ─── getConfigDir() ──────────────────────────────────────────────────────────

describe('getConfigDir()', () => {
  test('returns a non-empty absolute path containing PAI', async () => {
    const configDir = (await getPlatform()).getConfigDir();
    expect(configDir.length).toBeGreaterThan(0);
    expect(isAbsolutePath(configDir)).toBe(true);
    expect(configDir).toContain('PAI');
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('Unix: uses .config/PAI under home (no override)', async () => {
    if (!process.env.PAI_CONFIG_DIR) {
      const configDir = (await getPlatform()).getConfigDir();
      expect(configDir).toContain('.config');
      expect(configDir).toContain('PAI');
    }
  }, SLOW_TIMEOUT);
});

// ─── isKittyAvailable() ──────────────────────────────────────────────────────

describe('isKittyAvailable()', () => {
  test('returns a boolean', async () => {
    expect(typeof (await getPlatform()).isKittyAvailable()).toBe('boolean');
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: always returns false', async () => {
    expect((await getPlatform()).isKittyAvailable()).toBe(false);
  }, SLOW_TIMEOUT);
});

// ─── getKittySocketPath() ────────────────────────────────────────────────────

describe('getKittySocketPath()', () => {
  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: returns null', async () => {
    expect((await getPlatform()).getKittySocketPath()).toBeNull();
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('Unix: returns a non-empty string', async () => {
    const r = (await getPlatform()).getKittySocketPath();
    expect(typeof r).toBe('string');
    expect(r!.length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);
});

// ─── getTempFilePath() ───────────────────────────────────────────────────────

describe('getTempFilePath()', () => {
  test('result starts with platform temp dir, has prefix + extension', async () => {
    const { tmpdir } = await import('os');
    const r = (await getPlatform()).getTempFilePath('myprefix', '.log');
    expect(r.startsWith(tmpdir())).toBe(true);
    expect(r).toContain('myprefix');
    expect(r.endsWith('.log')).toBe(true);
    expect(isAbsolutePath(r)).toBe(true);
  }, SLOW_TIMEOUT);

  test('each call produces a unique path', async () => {
    const mod = await getPlatform();
    const p1 = mod.getTempFilePath('unique', '.tmp');
    await new Promise(resolve => setTimeout(resolve, 2));
    const p2 = mod.getTempFilePath('unique', '.tmp');
    expect(p1).not.toBe(p2);
  }, SLOW_TIMEOUT);
});

// ─── pathSeparator ───────────────────────────────────────────────────────────

describe('pathSeparator', () => {
  test('matches Node.js path.sep', async () => {
    expect((await getPlatform()).pathSeparator).toBe(sep);
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: is backslash', async () => {
    expect((await getPlatform()).pathSeparator).toBe('\\');
  }, SLOW_TIMEOUT);

  test.skipIf(IS_NATIVE_WINDOWS)('Unix: is forward slash', async () => {
    expect((await getPlatform()).pathSeparator).toBe('/');
  }, SLOW_TIMEOUT);
});

// ─── Cross-cutting consistency ───────────────────────────────────────────────

describe('Platform module consistency', () => {
  test('platform constant matches process.platform', async () => {
    expect((await getPlatform()).platform).toBe(process.platform);
  }, SLOW_TIMEOUT);

  test('exactly one of isWindows/isMacOS/isLinux is true', async () => {
    const mod = await getPlatform();
    expect([mod.isWindows, mod.isMacOS, mod.isLinux].filter(Boolean).length).toBe(1);
  }, SLOW_TIMEOUT);

  test('getConfigDir and getLogDir are different directories', async () => {
    const mod = await getPlatform();
    expect(mod.getConfigDir()).not.toBe(mod.getLogDir());
  }, SLOW_TIMEOUT);
});
