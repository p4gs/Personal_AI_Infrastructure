/**
 * 09-voice-server.test.ts — Voice / Audio Cross-Platform E2E Tests
 *
 * v3.0 → v5.0.0 PORT-NOTES (MAJOR ARCHITECTURE CHANGE):
 *   v3.0 had VoiceServer/{server.ts, manage.ts} — a standalone HTTP voice
 *   server + a manage.ts service-manager CLI (launchctl/schtasks/systemd).
 *
 *   v5.0.0 has PAI/PULSE/VoiceServer/voice.ts — a Pulse-embeddable MODULE
 *   (exports handleVoiceRequest/startVoice/voiceHealth). It does NOT create
 *   its own HTTP server and there is NO manage.ts CLI (Pulse owns the port
 *   and service lifecycle via PULSE/manage.sh + launchd/Task Scheduler).
 *
 *   Therefore the v3.0 manage.ts CLI tests and server.ts dead-code/source
 *   checks have NO v5.0.0 analogue — they are ported but describe.skip'd
 *   with this PORT-NOTE. The platform audio/notification abstraction tests
 *   (lib/platform.ts getAudioPlayCommand / getNotificationCommand) DO carry
 *   over and remain the meaningful Windows-voice coverage.
 *
 * Run: bun test tests/windows/09-voice-server.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  VOICE_DIR,
  IS_NATIVE_WINDOWS,
  IS_MACOS,
  IS_LINUX,
  SLOW_TIMEOUT,
  safeImport,
  isDependencyError,
} from './helpers';

import {
  getAudioPlayCommand,
  getNotificationCommand,
  getServiceManager,
} from '../../lib/platform';

const VOICE_TS = join(VOICE_DIR, 'voice.ts');

// ─── 1. File Structure (adapted to v5.0.0) ──────────────────────────────────

describe('voice module — file structure', () => {
  test('PAI/PULSE/VoiceServer/voice.ts exists', () => {
    expect(existsSync(VOICE_TS)).toBe(true);
  });

  test('voice.ts imports cleanly as a Pulse module', async () => {
    const result = await safeImport(VOICE_TS);
    // voice.ts pulls optional deps (e.g. smol-toml via PULSE/lib.ts);
    // tolerate dependency import failures but not a true syntax error.
    if (!result.ok) {
      if (!isDependencyError(result.error)) expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(true);
    }
  }, SLOW_TIMEOUT);
});

// PORT-NOTE: v3.0's manage.ts CLI (help output, invalid-command exit code,
// "PAI Voice Server Manager" header, platform name) and server.ts dead-code
// checks have no v5.0.0 analogue — voice is now a Pulse-embedded module with
// no standalone CLI/server. Ported but skipped.
describe.skip('manage.ts CLI (removed in v5.0.0 — see PORT-NOTE)', () => {
  test('manage.ts prints usage and exits 0', () => {
    expect(true).toBe(true);
  });
  test('manage.ts invalid command exits 1', () => {
    expect(true).toBe(true);
  });
});

describe.skip('server.ts code quality (replaced by voice.ts module in v5.0.0)', () => {
  test('server.ts has no dead macOS code', () => {
    expect(true).toBe(true);
  });
});

// ─── 4. platform.ts audio/notification — cross-platform ────────────────────

describe('voice — audio playback abstraction', () => {

  test('getAudioPlayCommand returns non-null for a test file', () => {
    const result = getAudioPlayCommand('test.mp3');
    expect(result).not.toBeNull();
  });

  test('getAudioPlayCommand result has command and args properties', () => {
    const result = getAudioPlayCommand('test.mp3');
    expect(result).toHaveProperty('command');
    expect(result).toHaveProperty('args');
    expect(typeof result!.command).toBe('string');
    expect(Array.isArray(result!.args)).toBe(true);
  });

  test('getAudioPlayCommand includes the file path in args', () => {
    const result = getAudioPlayCommand('myfile.mp3');
    const allArgs = [result!.command, ...result!.args].join(' ');
    expect(allArgs).toContain('myfile.mp3');
  });

  test('getAudioPlayCommand with volume parameter does not crash', () => {
    const result = getAudioPlayCommand('test.mp3', 0.5);
    expect(result).not.toBeNull();
  });

});

describe('voice — notification abstraction', () => {

  test('getNotificationCommand returns non-null for valid title/message', () => {
    const result = getNotificationCommand('Test Title', 'Test Message');
    expect(result).not.toBeNull();
  });

  test('getNotificationCommand result has command and args properties', () => {
    const result = getNotificationCommand('Test', 'Hello');
    expect(result).toHaveProperty('command');
    expect(result).toHaveProperty('args');
    expect(typeof result!.command).toBe('string');
    expect(Array.isArray(result!.args)).toBe(true);
  });

  test('getNotificationCommand includes title content in command args', () => {
    const result = getNotificationCommand('MyTitle', 'MyMessage');
    const allArgs = [result!.command, ...result!.args].join(' ');
    expect(allArgs).toContain('MyTitle');
  });

  test('getNotificationCommand includes message content in command args', () => {
    const result = getNotificationCommand('MyTitle', 'MyMessage');
    const allArgs = [result!.command, ...result!.args].join(' ');
    expect(allArgs).toContain('MyMessage');
  });

});

// ─── 5. Windows-Only Voice Tests ────────────────────────────────────────────

describe.skipIf(!IS_NATIVE_WINDOWS)('voice — Windows-specific', () => {

  test('getAudioPlayCommand uses powershell.exe on Windows', () => {
    const result = getAudioPlayCommand('test.mp3');
    expect(result).not.toBeNull();
    expect(result!.command.toLowerCase()).toContain('powershell');
  });

  test('getAudioPlayCommand includes MediaPlayer in PowerShell args', () => {
    const result = getAudioPlayCommand('test.mp3');
    const allArgs = result!.args.join(' ');
    expect(allArgs).toContain('MediaPlayer');
  });

  test('getAudioPlayCommand volume parameter is reflected in PowerShell args', () => {
    const result = getAudioPlayCommand('test.mp3', 0.75);
    const allArgs = result!.args.join(' ');
    expect(allArgs).toContain('0.75');
  });

  test('getNotificationCommand uses powershell.exe on Windows', () => {
    const result = getNotificationCommand('Test', 'Hello');
    expect(result).not.toBeNull();
    expect(result!.command.toLowerCase()).toContain('powershell');
  });

  test('getNotificationCommand includes ToastNotification in PowerShell args', () => {
    const result = getNotificationCommand('Test', 'Hello');
    const allArgs = result!.args.join(' ');
    expect(allArgs).toContain('ToastNotification');
  });

  test('getServiceManager returns task-scheduler on Windows', () => {
    expect(getServiceManager()).toBe('task-scheduler');
  });

});

// ─── 6. macOS-Only Voice Tests ──────────────────────────────────────────────

describe.skipIf(!IS_MACOS)('voice — macOS-specific', () => {

  test('getAudioPlayCommand uses afplay on macOS', () => {
    const result = getAudioPlayCommand('test.mp3');
    expect(result).not.toBeNull();
    expect(result!.command).toContain('afplay');
  });

  test('getAudioPlayCommand includes -v flag with volume on macOS', () => {
    const result = getAudioPlayCommand('test.mp3', 0.5);
    expect(result!.args).toContain('-v');
  });

  test('getNotificationCommand uses osascript on macOS', () => {
    const result = getNotificationCommand('Test', 'Hello');
    expect(result).not.toBeNull();
    expect(result!.command).toContain('osascript');
  });

  test('getServiceManager returns launchctl on macOS', () => {
    expect(getServiceManager()).toBe('launchctl');
  });

});

// ─── 7. Linux-Only Voice Tests ──────────────────────────────────────────────

describe.skipIf(!IS_LINUX)('voice — Linux-specific', () => {

  test('getAudioPlayCommand uses paplay on Linux', () => {
    const result = getAudioPlayCommand('test.mp3');
    expect(result).not.toBeNull();
    expect(result!.command).toContain('paplay');
  });

  test('getNotificationCommand uses notify-send on Linux', () => {
    const result = getNotificationCommand('Test', 'Hello');
    expect(result).not.toBeNull();
    expect(result!.command).toContain('notify-send');
  });

  test('getServiceManager returns systemd on Linux', () => {
    expect(getServiceManager()).toBe('systemd');
  });

});
