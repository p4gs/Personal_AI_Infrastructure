#!/usr/bin/env bun
/**
 * IntegrityCheck.hook.ts - PAI Integrity Check (SessionEnd)
 *
 * Runs system integrity check — detects PAI system file changes, spawns background maintenance.
 * Doc cross-ref integrity is handled by DocIntegrity.hook.ts (Stop event) to avoid double execution.
 *
 * TRIGGER: SessionEnd
 * PERFORMANCE: ~50ms (single transcript parse, one handler call). Non-blocking.
 */

import { parseTranscript } from '../PAI/TOOLS/TranscriptParser';
import { handleSystemIntegrity } from './handlers/SystemIntegrity';
import { readStdinWithTimeout } from './lib/stdin';

interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
}

async function readStdin(): Promise<HookInput | null> {
  try {
    // Cross-platform stdin (process.stdin, not Bun.stdin) — see lib/stdin.ts.
    const input = await readStdinWithTimeout(500);
    if (input.trim()) return JSON.parse(input) as HookInput;
  } catch {}
  return null;
}

async function main() {
  const hookInput = await readStdin();
  if (!hookInput?.transcript_path) { process.exit(0); }

  const parsed = parseTranscript(hookInput.transcript_path);

  // Run system integrity check (doc cross-ref is handled by DocIntegrity.hook.ts)
  await handleSystemIntegrity(parsed, hookInput);

  process.exit(0);
}

main().catch(() => process.exit(0));
