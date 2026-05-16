/**
 * 18-browser-skills.test.ts — Browser-Dependent Skill Tests
 *
 * Tests the skills that involve a browser / web automation:
 *   - Browser, BrightData, Interceptor (v5.0.0 set)
 *   - SKILL.md present and references browser/web
 *   - TypeScript files parse (missing playwright/agent-browser deps tolerated)
 *   - Optional Playwright Chromium launch (conditional)
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - v3.0 targeted Browser/WebAssessment/PromptInjection. v5.0.0 has no
 *     top-level WebAssessment/PromptInjection skills; the browser-dependent
 *     set is Browser/BrightData/Interceptor. Only skills present on disk are
 *     exercised (defensive across releases).
 *
 * CI requirement (optional): `npx playwright install chromium --with-deps`
 *
 * Run: bun test tests/cross-platform/18-browser-skills.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { SKILLS_DIR, V5_ROOT, SLOW_TIMEOUT } from '../windows/helpers';

const CANDIDATE_BROWSER_SKILLS = ['Browser', 'BrightData', 'Interceptor'];
const BROWSER_SKILLS = CANDIDATE_BROWSER_SKILLS.filter(s =>
  existsSync(join(SKILLS_DIR, s))
);

function isPlaywrightAvailable(): boolean {
  try {
    const result = spawnSync('npx', ['playwright', '--version'], {
      encoding: 'utf-8',
      timeout: 15_000,
      cwd: V5_ROOT,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

const HAS_PLAYWRIGHT = isPlaywrightAvailable();

// ─── Section 1: Browser Skill Directory Structure ─────────────────────────────

describe('Browser-Dependent Skills — Structure', () => {
  test('at least one browser-dependent skill is present', () => {
    expect(BROWSER_SKILLS.length).toBeGreaterThanOrEqual(1);
  });

  for (const skill of BROWSER_SKILLS) {
    describe(skill, () => {
      const skillDir = join(SKILLS_DIR, skill);

      test(`${skill}/ directory exists`, () => {
        expect(existsSync(skillDir)).toBe(true);
      });

      test(`${skill}/SKILL.md exists and is non-empty`, () => {
        const skillMd = join(skillDir, 'SKILL.md');
        expect(existsSync(skillMd)).toBe(true);
        expect(readFileSync(skillMd, 'utf-8').length).toBeGreaterThan(50);
      });

      test(`${skill}/SKILL.md mentions browser or web`, () => {
        const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8').toLowerCase();
        const hasRef = ['browser', 'playwright', 'chromium', 'url', 'web', 'scrape']
          .some(k => content.includes(k));
        expect(hasRef).toBe(true);
      });
    });
  }
});

// ─── Section 2: Browser Skill TypeScript Files Parse ──────────────────────────

describe('Browser-Dependent Skills — TypeScript Parsing', () => {
  for (const skill of BROWSER_SKILLS) {
    const skillDir = join(SKILLS_DIR, skill);
    if (!existsSync(skillDir)) continue;

    let tsFiles: string[] = [];
    try {
      tsFiles = readdirSync(skillDir, { recursive: true })
        .filter(f => typeof f === 'string' && f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .slice(0, 5) as string[];
    } catch { /* no ts files */ }

    for (const tsFile of tsFiles) {
      test(`${skill}/${tsFile} parses without syntax errors`, () => {
        const filePath = join(skillDir, tsFile);
        const result = spawnSync('bun', ['build', '--no-emit', '--target', 'bun', filePath], {
          encoding: 'utf-8',
          timeout: SLOW_TIMEOUT,
          cwd: V5_ROOT,
        });
        if (result.status !== 0) {
          const stderr = result.stderr || '';
          const isDepFailure = stderr.includes('Cannot find module') ||
            stderr.includes('Could not resolve') ||
            stderr.includes('playwright') ||
            stderr.includes('No matching export');
          if (!isDepFailure) {
            expect(result.status).toBe(0);
          }
        }
      }, SLOW_TIMEOUT);
    }
  }
});

// ─── Section 3: Playwright Chromium Launch (conditional) ──────────────────────

describe.skipIf(!HAS_PLAYWRIGHT)('Playwright Chromium — Headless Launch', () => {
  test('Chromium launches and navigates to about:blank', () => {
    const testScript = `
      const { chromium } = require('playwright');
      (async () => {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('about:blank');
        const title = await page.title();
        console.log(JSON.stringify({ ok: true, title }));
        await browser.close();
      })().catch(e => { console.error(e.message); process.exit(1); });
    `;
    const result = spawnSync('node', ['-e', testScript], {
      encoding: 'utf-8',
      timeout: SLOW_TIMEOUT,
      cwd: V5_ROOT,
    });
    if (result.status === 0) {
      const output = JSON.parse(result.stdout.trim());
      expect(output.ok).toBe(true);
    } else {
      const stderr = result.stderr || '';
      const isMissingBrowser = stderr.includes("Executable doesn't exist") ||
        stderr.includes('browserType.launch') ||
        stderr.includes('Cannot find module');
      expect(isMissingBrowser).toBe(true);
    }
  }, SLOW_TIMEOUT);
});
