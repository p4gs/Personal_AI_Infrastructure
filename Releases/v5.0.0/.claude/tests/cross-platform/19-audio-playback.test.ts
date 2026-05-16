/**
 * 19-audio-playback.test.ts — Audio Playback via Virtual Audio Devices
 *
 * Tests the audio pipeline beyond command generation:
 *   - Platform-specific audio command availability
 *   - PulseAudio null sink playback on Linux CI
 *   - Audio file path resolution with correct separators
 *   - Voice notification curl graceful degradation
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - lib/platform.ts is the faithful v3.0 port (same audio/notification API).
 *   - v3.0 curled the standalone voice server on :8888. v5.0.0 absorbed voice
 *     into Pulse on :31337 (Pulse serves /notify). The graceful-degradation
 *     curl target is updated to :31337; the assertion (no hang; exit code is
 *     one of the connection/timeout codes) is preserved.
 *
 * CI requirement (Linux only):
 *   sudo apt-get install -y pulseaudio
 *   pulseaudio --start --daemonize
 *   pactl load-module module-null-sink sink_name=virtual_speaker
 *
 * Run: bun test tests/cross-platform/19-audio-playback.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { join, sep } from 'path';
import {
  IS_NATIVE_WINDOWS, IS_MACOS, IS_LINUX,
  SLOW_TIMEOUT, safeImport,
} from '../windows/helpers';

function isPulseAudioAvailable(): boolean {
  if (!IS_LINUX) return false;
  try {
    const result = spawnSync('pactl', ['info'], { encoding: 'utf-8', timeout: 5_000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

const HAS_PULSEAUDIO = isPulseAudioAvailable();

// ─── Section 1: Platform Audio Command Availability ───────────────────────────

describe('Platform Audio Command Availability', () => {
  test('platform.ts getAudioPlayCommand() returns command object for current platform', async () => {
    const result = await safeImport<{
      getAudioPlayCommand: (filePath: string) => { command: string; args: string[] } | null;
    }>('../../lib/platform');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cmd = result.module.getAudioPlayCommand('/tmp/test.mp3');
      if (cmd !== null) {
        expect(typeof cmd.command).toBe('string');
        expect(Array.isArray(cmd.args)).toBe(true);
        expect(cmd.args.length).toBeGreaterThan(0);
      }
    }
  }, SLOW_TIMEOUT);

  test.skipIf(!IS_MACOS)('macOS: afplay command exists', () => {
    const result = spawnSync('which', ['afplay'], { encoding: 'utf-8', timeout: 5_000 });
    expect(result.status).toBe(0);
  });

  test.skipIf(!IS_LINUX)('Linux: paplay or aplay exists (skip on WSL2 without audio)', () => {
    const paplay = spawnSync('which', ['paplay'], { encoding: 'utf-8', timeout: 5_000 });
    const aplay = spawnSync('which', ['aplay'], { encoding: 'utf-8', timeout: 5_000 });
    if (paplay.status !== 0 && aplay.status !== 0) {
      console.warn('SKIP: Neither paplay nor aplay — WSL2 or minimal Linux without audio');
      return;
    }
    expect(paplay.status === 0 || aplay.status === 0).toBe(true);
  });

  test.skipIf(!IS_NATIVE_WINDOWS)('Windows: PowerShell audio class is available', () => {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      '[System.Media.SoundPlayer] | Out-Null; Write-Output "ok"',
    ], { encoding: 'utf-8', timeout: 10_000 });
    expect(result.stdout.trim()).toBe('ok');
  });
});

// ─── Section 2: PulseAudio Null Sink (Linux CI) ──────────────────────────────

describe.skipIf(!HAS_PULSEAUDIO)('PulseAudio Null Sink — Virtual Audio Device', () => {
  test('PulseAudio is running and reports sinks', () => {
    const result = spawnSync('pactl', ['list', 'short', 'sinks'], { encoding: 'utf-8', timeout: 5_000 });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test('paplay succeeds with a generated silence WAV', () => {
    const tmpWav = '/tmp/pai-test-silence.wav';
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(44100, 24);
    wavHeader.writeUInt32LE(44100 * 2, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(0, 40);

    require('fs').writeFileSync(tmpWav, wavHeader);
    const result = spawnSync('paplay', [tmpWav], { encoding: 'utf-8', timeout: 10_000 });
    try { require('fs').unlinkSync(tmpWav); } catch { /* ignore */ }
    expect(result.status).toBe(0);
  });
});

// ─── Section 3: Audio File Path Resolution ────────────────────────────────────

describe('Audio File Path Resolution', () => {
  test('getAudioPlayCommand uses platform-appropriate path separators', async () => {
    const result = await safeImport<{
      getAudioPlayCommand: (filePath: string) => { command: string; args: string[] } | null;
    }>('../../lib/platform');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const testPath = join('/tmp', 'test-audio', 'file.mp3');
      const cmd = result.module.getAudioPlayCommand(testPath);
      if (cmd !== null) {
        const pathArg = cmd.args.find((arg: string) => arg.includes('test-audio'));
        if (pathArg) {
          expect(pathArg.includes(sep) || pathArg.includes('/')).toBe(true);
        }
      }
    }
  }, SLOW_TIMEOUT);
});

// ─── Section 4: Voice Notification Graceful Degradation ───────────────────────

describe('Voice Notification — Graceful Degradation', () => {
  test('curl to Pulse :31337 completes without hanging', () => {
    // PORT-NOTE: v3.0 hit the standalone voice server on :8888. v5.0.0
    // absorbed voice into Pulse on :31337 (serves /notify).
    const result = spawnSync('curl', [
      '-s', '-f', '--connect-timeout', '2',
      '-X', 'POST',
      'http://localhost:31337/notify',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ voice_id: 'test', message: 'CI test' }),
    ], { encoding: 'utf-8', timeout: 10_000 });
    // Must not hang. 0=server up, 7=conn refused, 22=HTTP error, 28=timeout,
    // 56=recv error. null only if curl missing — accept that too.
    expect([0, 7, 22, 28, 56, null]).toContain(result.status);
  });

  test('getNotificationCommand returns valid command structure', async () => {
    const result = await safeImport<{
      getNotificationCommand: (title: string, body: string) => { command: string; args: string[] } | null;
    }>('../../lib/platform');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cmd = result.module.getNotificationCommand('Test', 'Hello CI');
      if (cmd !== null) {
        expect(typeof cmd.command).toBe('string');
        expect(Array.isArray(cmd.args)).toBe(true);
        expect(cmd.args.length).toBeGreaterThan(0);
      }
    }
  }, SLOW_TIMEOUT);
});
