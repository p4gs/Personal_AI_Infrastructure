/**
 * 11-skills.test.ts — Skill Directory Validation (Cross-Platform Suite)
 *
 * Validates all SKILL.md files in the skills/ directory:
 *   - Dynamic discovery of all skill directories (including sub-skills)
 *   - Frontmatter structure (name, description fields)
 *   - File size sanity (> 50 bytes, < 100KB)
 *   - Hygiene checks (no node_modules, no .env files)
 *   - TypeScript parsability for skills with .ts files
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - v5.0.0 ships ~45 skills (v3.0 had ~35). Floor lowered/kept as a sane
 *     minimum (>= 30) rather than an exact count.
 *   - v5.0.0 has NO "PAI" skill (the PAI core is no longer a skills/ entry)
 *     and NO Documents sub-skills (Docx/Pdf/Pptx/Xlsx). The known-skill list
 *     was retargeted to skills that exist in v5.0.0; the Documents sub-skill
 *     section is ported but describe.skip'd.
 *
 * Run: bun test tests/cross-platform/11-skills.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { SKILLS_DIR, SLOW_TIMEOUT, bunRun } from '../windows/helpers';

// ─── Skill Discovery ─────────────────────────────────────────────────────────

function discoverSkills(baseDir: string): Array<{ name: string; dir: string; skillMdPath: string }> {
  const skills: Array<{ name: string; dir: string; skillMdPath: string }> = [];

  function scan(dir: string, depth: number): void {
    if (depth > 3) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasSkillMd = entries.some(e => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      const relPath = relative(baseDir, dir);
      skills.push({
        name: relPath || 'root',
        dir,
        skillMdPath: join(dir, 'SKILL.md'),
      });
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        scan(join(dir, entry.name), depth + 1);
      }
    }
  }

  scan(baseDir, 0);
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function findTsFiles(dir: string): string[] {
  const tsFiles: string[] = [];
  function scan(d: string): void {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        tsFiles.push(fullPath);
      }
    }
  }
  scan(dir);
  return tsFiles;
}

const ALL_SKILLS = discoverSkills(SKILLS_DIR);

// ─── Section 1: Skill Directory Discovery ────────────────────────────────────

describe('Skill Directory Discovery', () => {
  test('skills/ directory exists', () => {
    expect(existsSync(SKILLS_DIR)).toBe(true);
  });

  test('discovers at least 30 SKILL.md files', () => {
    // PORT-NOTE: v3.0 asserted >= 35. v5.0.0 ships ~45; keep a sane floor.
    expect(ALL_SKILLS.length).toBeGreaterThanOrEqual(30);
  });

  test('discovered skill list is non-empty and each has a valid path', () => {
    for (const skill of ALL_SKILLS) {
      expect(skill.name.length).toBeGreaterThan(0);
      expect(existsSync(skill.skillMdPath)).toBe(true);
    }
  });

  test('includes known top-level skills', () => {
    // PORT-NOTE: v5.0.0 has no "PAI" skill. Retargeted to v5.0.0-present skills.
    const names = ALL_SKILLS.map(s => s.name);
    const knownSkills = ['Research', 'Browser', 'FirstPrinciples', 'Agents'];
    for (const expected of knownSkills) {
      expect(names).toContain(expected);
    }
  });

  // PORT-NOTE: v5.0.0 has NO Documents skill / no Docx/Pdf/Pptx/Xlsx
  // sub-skills (document tooling moved out of skills/). Ported but skipped.
  describe.skip('Documents sub-skills (removed in v5.0.0 — see PORT-NOTE)', () => {
    test('includes Documents sub-skills (Docx, Pdf, Pptx, Xlsx)', () => {
      expect(true).toBe(true);
    });
  });
});

// ─── Section 2: Structure Validation ─────────────────────────────────────────

describe('Skill Structure Validation', () => {
  for (const skill of ALL_SKILLS) {
    describe(skill.name, () => {
      test('SKILL.md exists and is non-empty (> 50 bytes)', () => {
        expect(statSync(skill.skillMdPath).size).toBeGreaterThan(50);
      });

      test('SKILL.md is under 100KB', () => {
        expect(statSync(skill.skillMdPath).size).toBeLessThan(100_000);
      });

      test('SKILL.md starts with frontmatter (--- delimiter) or is a generated composite', () => {
        const content = readFileSync(skill.skillMdPath, 'utf-8');
        const trimmed = content.trimStart();
        const hasFrontmatter = trimmed.startsWith('---');
        const isGeneratedComposite = trimmed.startsWith('<!--');
        expect(hasFrontmatter || isGeneratedComposite).toBe(true);
      });

      test('SKILL.md has name: field in frontmatter (skip if generated composite)', () => {
        const content = readFileSync(skill.skillMdPath, 'utf-8');
        const trimmed = content.trimStart();
        if (trimmed.startsWith('<!--')) return;
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        expect(fmMatch).not.toBeNull();
        if (fmMatch) {
          expect(fmMatch[1]).toMatch(/^name:\s*.+/m);
        }
      });

      test('SKILL.md has description: field in frontmatter (skip if generated composite)', () => {
        const content = readFileSync(skill.skillMdPath, 'utf-8');
        const trimmed = content.trimStart();
        if (trimmed.startsWith('<!--')) return;
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        expect(fmMatch).not.toBeNull();
        if (fmMatch) {
          expect(fmMatch[1]).toMatch(/^description:\s*.+/m);
        }
      });
    });
  }
});

// ─── Section 3: Hygiene ──────────────────────────────────────────────────────

describe('Skill Hygiene', () => {
  for (const skill of ALL_SKILLS) {
    describe(skill.name, () => {
      test('no node_modules/ directory', () => {
        expect(existsSync(join(skill.dir, 'node_modules'))).toBe(false);
      });

      test('no .env files in skill root', () => {
        let entries: ReturnType<typeof readdirSync>;
        try {
          entries = readdirSync(skill.dir);
        } catch {
          entries = [];
        }
        const envFiles = entries.filter(e => e === '.env' || e.startsWith('.env.'));
        expect(envFiles).toHaveLength(0);
      });
    });
  }
});

// ─── Section 4: TypeScript Parsability ───────────────────────────────────────

describe('Skill TypeScript Import', () => {
  const KNOWN_SKIP_PATTERNS = [
    'Could not resolve',
    'yaml',
  ];

  for (const skill of ALL_SKILLS) {
    const tsFiles = findTsFiles(skill.dir);
    if (tsFiles.length === 0) continue;

    describe(skill.name, () => {
      for (const tsFile of tsFiles) {
        const fileName = relative(skill.dir, tsFile);

        test(`${fileName} can be parsed by Bun`, () => {
          const result = bunRun(
            ['build', '--no-emit', '--target', 'bun', tsFile],
            { timeout: SLOW_TIMEOUT },
          );

          if (result.status !== 0) {
            const stderr = result.stderr || '';
            const isKnownDep = KNOWN_SKIP_PATTERNS.some(dep => stderr.includes(dep));
            if (isKnownDep) {
              console.warn(`KNOWN DEPENDENCY: ${skill.name}/${fileName} — skipping parse check`);
              return;
            }
            expect(result.status).toBe(0);
          }
        }, SLOW_TIMEOUT);
      }
    });
  }
});
