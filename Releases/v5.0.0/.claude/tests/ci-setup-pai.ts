#!/usr/bin/env bun
/**
 * CI PAI Setup — Configures PAI v5.0.0 for CI environments
 *
 * Run AFTER copying Releases/v5.0.0/.claude/ to ~/.claude/.
 * Resolves env template variables and sets a CI identity.
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - env.PAI_DIR resolves to ~/.claude/PAI (the PAI subsystem dir), not
 *     ~/.claude (which is the install root). PAI_CONFIG_DIR likewise.
 *   - There is NO skills/PAI/Tools/RebuildPAI.ts in v5.0.0; the SKILL rebuild
 *     step is dropped. SKILL/context wiring is handled by LoadContext.hook.ts
 *     and CLAUDE.md @imports at runtime — nothing to pre-bake for CI.
 *   - contextFiles is empty in the v5.0.0 template; the verify step checks
 *     for the hooks section + resolved env instead.
 *
 * Usage: bun run tests/ci-setup-pai.ts [--name NAME] [--ai-name AI_NAME] [--timezone TZ]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');
const PAI_DIR = join(CLAUDE_DIR, 'PAI');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

const args = process.argv.slice(2);
function getArg(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const principalName = getArg('--name', 'CI-Tester');
const aiName = getArg('--ai-name', 'CI-PAI');
const timezone = getArg('--timezone', 'UTC');

console.log('PAI v5.0.0 CI Setup');
console.log('════════════════════════════════════');
console.log(`  Platform:  ${process.platform} (${process.arch})`);
console.log(`  CLAUDE_DIR: ${CLAUDE_DIR}`);
console.log(`  PAI_DIR:    ${PAI_DIR}`);
console.log(`  Principal:  ${principalName}`);
console.log(`  AI Name:    ${aiName}`);
console.log(`  Timezone:   ${timezone}`);
console.log();

if (!existsSync(SETTINGS_PATH)) {
  console.error(`ERROR: ${SETTINGS_PATH} not found`);
  console.error('  Copy Releases/v5.0.0/.claude/ to ~/.claude/ first.');
  process.exit(1);
}

// ─── 1. Update settings.json ─────────────────────────────────────────────────

console.log('1. Updating settings.json...');
const raw = readFileSync(SETTINGS_PATH, 'utf-8');
const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
const settings = JSON.parse(clean);

// Resolve template variables to actual paths (v5.0.0: PAI_DIR = ~/.claude/PAI)
settings.env = {
  ...settings.env,
  PAI_DIR,
  PROJECTS_DIR: resolve(homedir()),
  PAI_CONFIG_DIR: PAI_DIR,
};

settings.principal = {
  ...settings.principal,
  name: principalName,
  timezone,
};

settings.daidentity = {
  ...settings.daidentity,
  name: aiName,
  fullName: `${aiName} — Personal AI`,
  displayName: aiName.toUpperCase(),
};

writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
console.log(`  Done — ${SETTINGS_PATH}`);

// ─── 2. Create required directories ──────────────────────────────────────────

console.log('2. Ensuring directory structure...');
const dirs = [
  'PAI/MEMORY', 'PAI/MEMORY/STATE', 'PAI/MEMORY/WORK',
  'PAI/MEMORY/LEARNING',
  'Plans',
];
for (const dir of dirs) {
  const fullPath = join(CLAUDE_DIR, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    console.log(`  Created ${dir}/`);
  }
}
console.log('  Done');

// ─── 3. Verify ───────────────────────────────────────────────────────────────

console.log('3. Verification...');
const verify = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
const checks: [string, boolean][] = [
  ['env.PAI_DIR resolved (no ${...})', !String(verify.env?.PAI_DIR || '').includes('${')],
  ['env.PAI_DIR ends with /PAI or \\PAI', /[/\\]PAI$/.test(String(verify.env?.PAI_DIR || ''))],
  [`principal.name = "${principalName}"`, verify.principal?.name === principalName],
  [`daidentity.name = "${aiName}"`, verify.daidentity?.name === aiName],
  ['hooks section present', !!verify.hooks && Object.keys(verify.hooks).length > 0],
];

let allPass = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${label}`);
  if (!pass) allPass = false;
}

if (allPass) {
  console.log('\nPAI v5.0.0 configured for CI successfully');
} else {
  console.error('\nSome checks failed — CI tests may not work correctly');
  process.exit(1);
}
