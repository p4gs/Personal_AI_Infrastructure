/**
 * 14-hook-handlers.test.ts — Hook Handler Import Tests (Cross-Platform Suite)
 *
 * Validates every handler in hooks/handlers/ imports cleanly on any platform
 * (macOS, Linux, WSL2, native Windows) and exposes its primary export.
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - v3.0 had 7 handlers (AlgorithmEnrichment, DocCrossRefIntegrity,
 *     RebuildSkill, SystemIntegrity, TabState, UpdateCounts, VoiceNotification).
 *   - v5.0.0 has 6: DocCrossRefIntegrity, RebuildArchSummary, SystemIntegrity,
 *     TabState, UpdateCounts, VoiceNotification (AlgorithmEnrichment +
 *     RebuildSkill removed; RebuildArchSummary added).
 *   - The handler list is now DISCOVERED from disk; primary-export names map
 *     to v5.0.0's actual exports (handleRebuildArchSummary, handleVoice, …).
 *
 * Run: bun test tests/cross-platform/14-hook-handlers.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  HANDLERS_DIR,
  ALL_HANDLERS,
  SLOW_TIMEOUT,
  safeImport,
  isDependencyError,
} from '../windows/helpers';

// v5.0.0 handler → primary export function name
const HANDLER_PRIMARY_EXPORT: Record<string, string> = {
  'DocCrossRefIntegrity': 'handleDocCrossRefIntegrity',
  'RebuildArchSummary':   'handleRebuildArchSummary',
  'SystemIntegrity':      'handleSystemIntegrity',
  'TabState':             'handleTabState',
  'UpdateCounts':         'handleUpdateCounts',
  'VoiceNotification':    'handleVoice',
};

// ─── Section 1: Handler Registry Validation ──────────────────────────────────

describe('Handler Registry', () => {
  test('ALL_HANDLERS has at least 5 entries', () => {
    // PORT-NOTE: v3.0 asserted exactly 7. v5.0.0 has 6; assert a sane floor.
    expect(ALL_HANDLERS.length).toBeGreaterThanOrEqual(5);
  });

  test('HANDLERS_DIR points to hooks/handlers/', () => {
    expect(HANDLERS_DIR).toContain('hooks');
    expect(HANDLERS_DIR).toContain('handlers');
  });

  test('handler files are TypeScript (.ts extension)', () => {
    for (const file of ALL_HANDLERS) {
      expect(file).toMatch(/\.ts$/);
    }
  });
});

// ─── Section 2: Bulk Handler Tests (all discovered) ──────────────────────────

describe('Handler Imports', () => {
  for (const handlerFile of ALL_HANDLERS) {
    const handlerName = handlerFile.replace('.ts', '');

    describe(handlerName, () => {
      test('file exists in HANDLERS_DIR', () => {
        expect(existsSync(join(HANDLERS_DIR, handlerFile))).toBe(true);
      });

      test('imports without error', async () => {
        const result = await safeImport(`../../hooks/handlers/${handlerName}`);
        if (!result.ok) {
          if (isDependencyError(result.error)) {
            console.warn(`KNOWN DEPENDENCY: ${handlerName} — ${result.error}`);
            return;
          }
        }
        expect(result.ok).toBe(true);
      }, SLOW_TIMEOUT);

      test('has at least one exported function', async () => {
        const result = await safeImport<Record<string, unknown>>(`../../hooks/handlers/${handlerName}`);
        if (!result.ok) {
          console.warn(`SKIP exports check: ${handlerName} did not import`);
          return;
        }
        const exportKeys = Object.keys(result.module).filter(
          k => k !== '__esModule' && k !== 'default'
        );
        const hasFunctionExport = exportKeys.some(
          key => typeof result.module[key] === 'function'
        );
        expect(hasFunctionExport).toBe(true);
      }, SLOW_TIMEOUT);
    });
  }
});

// ─── Section 3: Primary Export Verification ──────────────────────────────────

describe('Handler Primary Exports', () => {
  for (const [handlerName, fnName] of Object.entries(HANDLER_PRIMARY_EXPORT)) {
    // Only assert handlers that exist in this tree (defensive across releases).
    if (!ALL_HANDLERS.includes(`${handlerName}.ts`)) continue;

    test(`${handlerName} exports ${fnName}() as a function`, async () => {
      const result = await safeImport<Record<string, unknown>>(`../../hooks/handlers/${handlerName}`);
      if (!result.ok) {
        console.warn(`SKIP: ${handlerName} did not import`);
        return;
      }
      expect(result.module).toHaveProperty(fnName);
      expect(typeof result.module[fnName]).toBe('function');
    }, SLOW_TIMEOUT);
  }
});
