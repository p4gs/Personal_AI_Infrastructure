/**
 * 24-web-installer.test.ts — Web Installer Routes & Server Tests
 *
 * Validates the WebSocket-driven web installer infrastructure:
 *   Part 1: routes.ts unit tests (direct import, no server spawn)
 *   Part 2: server.ts HTTP tests (spawned as separate process)
 *   Part 3: Server crash resilience
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - Web installer moved to PAI/PAI-Install/web/. Structure is otherwise
 *     identical: routes.ts exports handleWsMessage/addClient/removeClient/
 *     getState; server.ts uses PAI_INSTALL_PORT, serves public/ with MIME
 *     types, SPA index.html fallback, /ws WebSocket, no-cache headers.
 *     This is a near-verbatim port (only INSTALL_DIR path changed).
 *
 * Run: bun test tests/cross-platform/24-web-installer.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { INSTALL_DIR, SLOW_TIMEOUT, safeImport } from '../windows/helpers';
import type { Subprocess } from 'bun';

const ROUTES_PATH = join(INSTALL_DIR, 'web', 'routes.ts');
const SERVER_PATH = join(INSTALL_DIR, 'web', 'server.ts');
const testPort = 19500 + Math.floor(Math.random() * 500);

// ══════════════════════════════════════════════════════════════════════════════
// PART 1: Web Routes Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Part 1: Web Routes Unit Tests', () => {

  describe('Section 1: Module Import', () => {
    test('routes.ts imports without error via safeImport', async () => {
      const result = await safeImport(ROUTES_PATH);
      expect(result.ok).toBe(true);
    }, SLOW_TIMEOUT);

    for (const fn of ['handleWsMessage', 'addClient', 'removeClient', 'getState']) {
      test(`exports ${fn} function`, async () => {
        const result = await safeImport<Record<string, unknown>>(ROUTES_PATH);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(typeof result.module[fn]).toBe('function');
        }
      }, SLOW_TIMEOUT);
    }
  });

  describe('Section 2: Client Management', () => {
    let addClient: (ws: any) => void;
    let removeClient: (ws: any) => void;

    beforeAll(async () => {
      const result = await safeImport<any>(ROUTES_PATH);
      if (!result.ok) throw new Error(`Failed to import routes: ${result.error}`);
      addClient = result.module.addClient;
      removeClient = result.module.removeClient;
    });

    test('addClient does not throw on mock WebSocket', () => {
      const mockWs = { send: (_d: string) => {}, close: () => {} };
      expect(() => addClient(mockWs)).not.toThrow();
    });

    test('removeClient does not throw on previously added client', () => {
      const mockWs = { send: (_d: string) => {}, close: () => {} };
      addClient(mockWs);
      expect(() => removeClient(mockWs)).not.toThrow();
    });

    test('removeClient does not throw on non-existent client', () => {
      const unknownWs = { send: (_d: string) => {}, close: () => {} };
      expect(() => removeClient(unknownWs)).not.toThrow();
    });
  });

  describe('Section 3: getState() Initial State', () => {
    test('getState returns null before any installation starts', async () => {
      const result = await safeImport<any>(ROUTES_PATH);
      if (!result.ok) throw new Error(`Failed to import routes: ${result.error}`);
      expect(result.module.getState()).toBeNull();
    }, SLOW_TIMEOUT);
  });

  describe('Section 4-8: handleWsMessage robustness', () => {
    let handleWsMessage: (ws: any, raw: string) => void;
    let addClient: (ws: any) => void;

    beforeAll(async () => {
      const result = await safeImport<any>(ROUTES_PATH);
      if (!result.ok) throw new Error(`Failed to import routes: ${result.error}`);
      handleWsMessage = result.module.handleWsMessage;
      addClient = result.module.addClient;
    });

    const mockWs = { send: (_d: string) => {}, close: () => {} };

    test('invalid JSON / empty / malformed do not throw', () => {
      expect(() => handleWsMessage(mockWs, 'not json')).not.toThrow();
      expect(() => handleWsMessage(mockWs, '')).not.toThrow();
      expect(() => handleWsMessage(mockWs, '{broken')).not.toThrow();
    });

    test('unknown / empty message type does not throw', () => {
      expect(() => handleWsMessage(mockWs, JSON.stringify({ type: 'unknown_type' }))).not.toThrow();
      expect(() => handleWsMessage(mockWs, JSON.stringify({ type: '' }))).not.toThrow();
    });

    test('client_ready replays history without throwing', () => {
      const ws = { send: (_d: string) => {}, close: () => {} };
      addClient(ws);
      expect(() => handleWsMessage(ws, JSON.stringify({ type: 'client_ready' }))).not.toThrow();
    });

    test('user_input / user_choice with nonexistent requestId do not throw', () => {
      expect(() => handleWsMessage(mockWs, JSON.stringify({ type: 'user_input', requestId: 'nope', value: 'x' }))).not.toThrow();
      expect(() => handleWsMessage(mockWs, JSON.stringify({ type: 'user_choice', requestId: 'nope', value: 'x' }))).not.toThrow();
    });

    test('start_install does not throw synchronously', () => {
      const ws = { send: (_d: string) => {}, close: () => {} };
      addClient(ws);
      expect(() => handleWsMessage(ws, JSON.stringify({ type: 'start_install' }))).not.toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 2: Web Server HTTP Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Part 2: Web Server HTTP Tests', () => {
  let serverProc: Subprocess | null = null;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  beforeAll(async () => {
    serverProc = Bun.spawn(['bun', 'run', SERVER_PATH], {
      cwd: INSTALL_DIR,
      env: { ...process.env, PAI_INSTALL_PORT: testPort.toString(), PAI_TEST_MODE: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const deadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${baseUrl}/`);
        if (resp.status >= 200 && resp.status < 500) { ready = true; break; }
      } catch { /* not ready */ }
      await Bun.sleep(200);
    }
    if (!ready) throw new Error(`Web server failed to start on port ${testPort} within 8s`);
  }, SLOW_TIMEOUT);

  afterAll(() => {
    if (serverProc) {
      try { serverProc.kill(); } catch { /* already exited */ }
    }
  });

  describe('Section 10: Static File Serving', () => {
    test('GET / returns 200 with HTML content', async () => {
      const resp = await fetch(`${baseUrl}/`);
      expect(resp.status).toBe(200);
      expect((resp.headers.get('content-type') || '')).toContain('text/html');
    });

    test('GET / body contains HTML', async () => {
      const body = await (await fetch(`${baseUrl}/`)).text();
      expect(body).toContain('<');
      expect(body.toLowerCase()).toContain('html');
    });

    test('GET /styles.css returns CSS content-type (or SPA fallback)', async () => {
      const resp = await fetch(`${baseUrl}/styles.css`);
      if (resp.status === 200) {
        const ct = resp.headers.get('content-type') || '';
        expect(ct.includes('text/css') || ct.includes('text/html')).toBe(true);
      }
    });
  });

  describe('Section 11: MIME Type Detection', () => {
    test('GET /index.html maps to text/html', async () => {
      const resp = await fetch(`${baseUrl}/index.html`);
      expect(resp.status).toBe(200);
      expect((resp.headers.get('content-type') || '')).toContain('text/html');
    });

    test('server sets no-cache headers', async () => {
      const resp = await fetch(`${baseUrl}/`);
      expect((resp.headers.get('cache-control') || '')).toContain('no-cache');
    });
  });

  describe('Section 12: Directory Traversal Prevention', () => {
    test('GET /../../../etc/passwd does not serve system files', async () => {
      const resp = await fetch(`${baseUrl}/../../../etc/passwd`);
      const body = await resp.text();
      expect(body).not.toContain('root:');
      expect([200, 403, 404]).toContain(resp.status);
    });
  });

  describe('Section 13: 404 / SPA Fallback', () => {
    test('GET /nonexistent-path returns SPA fallback or 404', async () => {
      const resp = await fetch(`${baseUrl}/nonexistent-path`);
      expect([200, 404]).toContain(resp.status);
      if (resp.status === 200) {
        expect((resp.headers.get('content-type') || '')).toContain('text/html');
      }
    });
  });

  describe('Section 14: WebSocket Upgrade', () => {
    test('WebSocket connection succeeds', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
      const connected = await new Promise<boolean>((resolve) => {
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 5000);
      });
      if (connected) ws.close();
      expect(connected).toBe(true);
    }, SLOW_TIMEOUT);

    test('WebSocket receives a message on open', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
      const firstMessage = await new Promise<string | null>((resolve) => {
        ws.onmessage = (event) => resolve(String(event.data));
        ws.onerror = () => resolve(null);
        setTimeout(() => resolve(null), 5000);
      });
      ws.close();
      expect(firstMessage).not.toBeNull();
      if (firstMessage) {
        const parsed = JSON.parse(firstMessage);
        expect(typeof parsed.type).toBe('string');
      }
    }, SLOW_TIMEOUT);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 3: Server Crash Resilience
// ══════════════════════════════════════════════════════════════════════════════

describe('Part 3: Server Crash Resilience', () => {
  let serverProc: Subprocess | null = null;
  const resiliencePort = testPort + 1;
  const baseUrl = `http://127.0.0.1:${resiliencePort}`;

  beforeAll(async () => {
    serverProc = Bun.spawn(['bun', 'run', SERVER_PATH], {
      cwd: INSTALL_DIR,
      env: { ...process.env, PAI_INSTALL_PORT: resiliencePort.toString(), PAI_TEST_MODE: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const deadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${baseUrl}/`);
        if (resp.status >= 200 && resp.status < 500) { ready = true; break; }
      } catch { /* not ready */ }
      await Bun.sleep(200);
    }
    if (!ready) throw new Error(`Resilience server failed to start on port ${resiliencePort} within 8s`);
  }, SLOW_TIMEOUT);

  afterAll(() => {
    if (serverProc) {
      try { serverProc.kill(); } catch { /* already exited */ }
    }
  });

  describe('Section 15: Server starts without errors', () => {
    test('server process is running (not exited immediately)', () => {
      expect(serverProc).not.toBeNull();
      expect(serverProc!.exitCode).toBeNull();
    });
  });

  describe('Section 16: Server responds after rapid requests', () => {
    test('5 rapid GET / requests all return 200', async () => {
      const statuses = await Promise.all(
        Array.from({ length: 5 }, () => fetch(`${baseUrl}/`).then(r => r.status))
      );
      for (const status of statuses) expect(status).toBe(200);
    });

    test('server still responds after rapid requests', async () => {
      expect((await fetch(`${baseUrl}/`)).status).toBe(200);
    });
  });
});
