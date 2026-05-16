#!/usr/bin/env bun
/**
 * PAI v5.0.0 Full Verification Test
 *
 * Single prompt, ~$0.10-0.50 per run. Proves PAI is operational by checking
 * that PAI artifact markers appear in Claude's output. Uses a generic prompt
 * (no PAI-specific callouts) so passing proves PAI context genuinely loaded.
 *
 * Uses --output-format stream-json to capture ALL assistant text.
 *
 * v3.0 → v5.0.0 PORT-NOTES:
 *   - settings.json lives at ~/.claude/settings.json (install root); the PAI
 *     subsystem is ~/.claude/PAI. Identity is read from settings.principal /
 *     settings.daidentity (unchanged shape).
 *   - Algorithm/phase markers kept generic so format-version drift (v5.0.0
 *     Algorithm 6.x) does not break the floor (MIN_PASS_COUNT = 3).
 *
 * Prerequisites:
 *   - CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY
 *   - PAI installed at ~/.claude/ (via ci-setup-pai.ts)
 *   - Claude CLI in PATH
 */

import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MODEL = process.env.PAI_TEST_MODEL || 'claude-sonnet-4-6';
const MAX_TURNS = parseInt(process.env.PAI_TEST_MAX_TURNS || '8', 10);
const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

const PROMPT = 'What are the three most important principles of good software architecture and why? Be thorough but concise.';
const MIN_PASS_COUNT = 3;

interface Marker { name: string; pattern: RegExp; }

function buildMarkers(identity: { user: string; ai: string }): Marker[] {
  return [
    { name: 'Algorithm/PAI header', pattern: /♻|PAI ALGORITHM|🤖 PAI|PAI \| /i },
    { name: 'Phase: OBSERVE', pattern: /OBSERVE/i },
    { name: 'Phase: THINK', pattern: /THINK/i },
    { name: 'Phase: EXECUTE', pattern: /EXECUTE/i },
    { name: 'Phase: VERIFY', pattern: /VERIFY/i },
    { name: `User identity ("${identity.user}")`, pattern: new RegExp(identity.user || '\\u0000', 'i') },
    { name: `AI identity ("${identity.ai}")`, pattern: new RegExp(identity.ai || '\\u0000', 'i') },
    { name: 'Voice line (🗣️)', pattern: /🗣️/ },
    { name: 'ISC or TASK', pattern: /ISC|Ideal State|TASK:/i },
    { name: 'Capability/skill audit', pattern: /CAPABILIT|skill/i },
    { name: 'Effort level', pattern: /EFFORT LEVEL|Instant|Fast|Standard|Extended/i },
  ];
}

function readIdentity(): { user: string; ai: string } {
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    return {
      user: (settings.principal?.name || '').toLowerCase(),
      ai: (settings.daidentity?.name || '').toLowerCase(),
    };
  } catch {
    return { user: '', ai: '' };
  }
}

interface RunResult { text: string; sessionId: string; cost: number; numTurns: number; }

function runClaude(prompt: string): RunResult {
  const escapedPrompt = prompt.replace(/"/g, '\\"');
  const command = `claude -p "${escapedPrompt}" --model ${MODEL} --max-turns ${MAX_TURNS} --output-format stream-json --verbose`;

  console.log(`  $ claude -p "${prompt.slice(0, 60)}..." --max-turns ${MAX_TURNS} --model ${MODEL}`);

  const result = spawnSync(command, {
    encoding: 'utf-8',
    timeout: 300_000,
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
    shell: true,
  });

  if (result.error) {
    console.error(`  Spawn error: ${result.error.message}`);
    return { text: '', sessionId: '', cost: 0, numTurns: 0 };
  }

  const stdout = result.stdout || '';
  const textParts: string[] = [];
  let sessionId = '';
  let cost = 0;
  let numTurns = 0;

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'assistant' && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === 'text' && block.text) textParts.push(block.text);
        }
      }
      if (obj.type === 'content_block_delta' && obj.delta?.text) textParts.push(obj.delta.text);
      if (obj.type === 'result') {
        sessionId = obj.session_id || '';
        cost = obj.cost_usd || obj.total_cost || 0;
        numTurns = obj.num_turns || 0;
        if (obj.result) textParts.push(obj.result);
      }
    } catch {
      if (line.trim().length > 10) textParts.push(line);
    }
  }

  if (result.stderr) textParts.push(result.stderr);

  return { text: textParts.join('\n'), sessionId, cost, numTurns };
}

function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PAI v5.0.0 Full Verification Test');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Platform:  ${process.platform} (${process.arch})`);
  console.log(`  Model:     ${MODEL}`);
  console.log(`  CLAUDE_DIR: ${CLAUDE_DIR}`);
  console.log();

  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.error('ERROR: Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set');
    process.exit(1);
  }
  console.log(`  Auth:      ${process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'OAuth' : 'API Key'}`);

  if (!existsSync(SETTINGS_PATH)) {
    console.error(`ERROR: PAI not installed — ${SETTINGS_PATH} missing`);
    process.exit(1);
  }

  const identity = readIdentity();
  if (!identity.user || !identity.ai) {
    console.error('ERROR: Could not read identity from settings.json');
    process.exit(1);
  }
  console.log(`  User:      "${identity.user}"`);
  console.log(`  AI:        "${identity.ai}"`);
  console.log();

  console.log('── Running PAI verification prompt ──');
  const { text, sessionId, cost, numTurns } = runClaude(PROMPT);

  console.log(`  Session:   ${sessionId || '(not reported)'}`);
  console.log(`  Turns:     ${numTurns}`);
  console.log(`  Cost:      $${cost.toFixed(4)}`);
  console.log(`  Output:    ${text.length} chars`);
  console.log();

  if (text.length === 0) {
    console.error('FATAL: Claude produced no output (stream-json returned no text)');
    process.exit(1);
  }

  console.log('── PAI Artifact Verification ──');
  const markers = buildMarkers(identity);
  let passes = 0;
  for (const marker of markers) {
    const found = marker.pattern.test(text);
    if (found) passes++;
    console.log(`  [${found ? 'PASS' : 'MISS'}] ${marker.name}`);
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Markers:    ${passes}/${markers.length} detected`);
  console.log(`  Threshold:  ${MIN_PASS_COUNT} minimum`);
  console.log('═══════════════════════════════════════════════════════');

  if (passes < MIN_PASS_COUNT) {
    console.error(`\n  PAI VERIFICATION FAILED — only ${passes} markers (need ${MIN_PASS_COUNT}+)`);
    console.error('\n  ── Output excerpt (first 3000 chars) ──');
    console.error(text.slice(0, 3000));
    process.exit(1);
  }

  console.log(`\n  PAI VERIFICATION PASSED (${passes}/${markers.length} markers)`);
}

main();
