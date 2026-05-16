/**
 * Terminal Abstraction Layer — Unit Tests
 *
 * Run: bun test lib/terminal.test.ts
 *
 * Ported verbatim from PAI v3.0 — lib/terminal.ts is faithfully ported from
 * v3.0 by the parallel platform-port agent (same export names/contract).
 */

import { describe, test, expect, afterEach } from 'bun:test';
import {
  KittyTerminalAdapter,
  WindowsTerminalAdapter,
  GenericTerminalAdapter,
  createTerminalAdapter,
  getTerminalSize,
} from './terminal';

describe('Terminal Abstraction Layer', () => {

  describe('KittyTerminalAdapter', () => {
    test('has type "kitty"', () => {
      expect(new KittyTerminalAdapter('unix:/tmp/kitty-test').type).toBe('kitty');
    });

    test('is supported', () => {
      expect(new KittyTerminalAdapter('unix:/tmp/kitty-test').supported).toBe(true);
    });

    test('setTitle does not throw', () => {
      const adapter = new KittyTerminalAdapter('unix:/tmp/kitty-test');
      expect(() => adapter.setTitle('Test Title')).not.toThrow();
    });

    test('setTabColor does not throw', () => {
      const adapter = new KittyTerminalAdapter('unix:/tmp/kitty-test');
      expect(() => adapter.setTabColor({
        activeBg: '#000000', activeFg: '#ffffff',
        inactiveBg: '#333333', inactiveFg: '#cccccc',
      })).not.toThrow();
    });

    test('resetTabColor does not throw', () => {
      const adapter = new KittyTerminalAdapter('unix:/tmp/kitty-test');
      expect(() => adapter.resetTabColor()).not.toThrow();
    });
  });

  describe('WindowsTerminalAdapter', () => {
    test('has type "windows-terminal"', () => {
      expect(new WindowsTerminalAdapter().type).toBe('windows-terminal');
    });

    test('is supported', () => {
      expect(new WindowsTerminalAdapter().supported).toBe(true);
    });

    test('setTitle does not throw', () => {
      const adapter = new WindowsTerminalAdapter();
      expect(() => adapter.setTitle('Test Title')).not.toThrow();
    });

    test('setTabColor is no-op (does not throw)', () => {
      const adapter = new WindowsTerminalAdapter();
      expect(() => adapter.setTabColor({
        activeBg: '#000000', activeFg: '#ffffff',
        inactiveBg: '#333333', inactiveFg: '#cccccc',
      })).not.toThrow();
    });

    test('resetTabColor is no-op (does not throw)', () => {
      const adapter = new WindowsTerminalAdapter();
      expect(() => adapter.resetTabColor()).not.toThrow();
    });
  });

  describe('GenericTerminalAdapter', () => {
    test('has type "generic"', () => {
      expect(new GenericTerminalAdapter().type).toBe('generic');
    });

    test('is NOT supported', () => {
      expect(new GenericTerminalAdapter().supported).toBe(false);
    });

    test('all methods are no-op (no throw)', () => {
      const adapter = new GenericTerminalAdapter();
      expect(() => adapter.setTitle('Test')).not.toThrow();
      expect(() => adapter.setTabColor({
        activeBg: '#000', activeFg: '#fff',
        inactiveBg: '#333', inactiveFg: '#ccc',
      })).not.toThrow();
      expect(() => adapter.resetTabColor()).not.toThrow();
    });
  });

  describe('createTerminalAdapter', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env.TERM = origEnv.TERM;
      process.env.KITTY_WINDOW_ID = origEnv.KITTY_WINDOW_ID;
      process.env.KITTY_LISTEN_ON = origEnv.KITTY_LISTEN_ON;
      process.env.WT_SESSION = origEnv.WT_SESSION;
      process.env.WT_PROFILE_ID = origEnv.WT_PROFILE_ID;
    });

    test('returns GenericTerminalAdapter when no terminal detected', () => {
      delete process.env.KITTY_WINDOW_ID;
      delete process.env.KITTY_LISTEN_ON;
      delete process.env.WT_SESSION;
      delete process.env.WT_PROFILE_ID;
      process.env.TERM = 'xterm-256color';
      expect(createTerminalAdapter(null).type).toBe('generic');
    });

    test('returns WindowsTerminalAdapter when WT_SESSION set', () => {
      delete process.env.KITTY_WINDOW_ID;
      delete process.env.KITTY_LISTEN_ON;
      process.env.TERM = 'xterm-256color';
      process.env.WT_SESSION = 'test-session-id';
      delete process.env.WT_PROFILE_ID;
      process.env.WT_SESSION = 'test-session-id';
      expect(createTerminalAdapter(null).type).toBe('windows-terminal');
    });
  });

  describe('getTerminalSize', () => {
    test('returns object with columns and rows', () => {
      const size = getTerminalSize();
      expect(typeof size.columns).toBe('number');
      expect(typeof size.rows).toBe('number');
      expect(size.columns).toBeGreaterThan(0);
      expect(size.rows).toBeGreaterThan(0);
    });

    test('defaults to >= 1', () => {
      const size = getTerminalSize();
      expect(size.columns).toBeGreaterThanOrEqual(1);
      expect(size.rows).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Three implementations exist', () => {
    test('KittyTerminalAdapter implements TerminalAdapter', () => {
      const a = new KittyTerminalAdapter('unix:/tmp/test');
      expect(a.type).toBeDefined();
      expect(a.supported).toBeDefined();
      expect(typeof a.setTitle).toBe('function');
      expect(typeof a.setTabColor).toBe('function');
      expect(typeof a.resetTabColor).toBe('function');
    });

    test('WindowsTerminalAdapter implements TerminalAdapter', () => {
      const a = new WindowsTerminalAdapter();
      expect(a.type).toBeDefined();
      expect(a.supported).toBeDefined();
      expect(typeof a.setTitle).toBe('function');
      expect(typeof a.setTabColor).toBe('function');
      expect(typeof a.resetTabColor).toBe('function');
    });

    test('GenericTerminalAdapter implements TerminalAdapter', () => {
      const a = new GenericTerminalAdapter();
      expect(a.type).toBeDefined();
      expect(a.supported).toBeDefined();
      expect(typeof a.setTitle).toBe('function');
      expect(typeof a.setTabColor).toBe('function');
      expect(typeof a.resetTabColor).toBe('function');
    });
  });
});
