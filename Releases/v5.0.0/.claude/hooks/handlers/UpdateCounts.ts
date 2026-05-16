/**
 * UpdateCounts.ts - Update settings.json with fresh system counts
 *
 * PURPOSE:
 * Updates the counts section of settings.json at the end of each session.
 * Banner and statusline then read from settings.json (instant, no execution).
 *
 * ARCHITECTURE:
 * SessionEnd hook → UpdateCounts → settings.json
 * Session start → Banner reads settings.json (instant)
 * Session start → Statusline reads settings.json (instant)
 *
 * This design ensures:
 * - No spawning/execution at session start
 * - Counts are always available (no waiting)
 * - Single source of truth in settings.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { getPaiDir, getSettingsPath, getClaudeDir } from '../lib/paths';
import { homedir } from "node:os"


interface Counts {
  skills: number;
  skillsPublic: number;
  skillsPrivate: number;
  workflows: number;
  hooks: number;
  signals: number;
  files: number;
  work: number;
  sessions: number;
  research: number;
  ratings: number;
  updatedAt: string;
}

/**
 * Count files matching criteria recursively
 */
function countFilesRecursive(dir: string, extension?: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFilesRecursive(fullPath, extension);
      } else if (entry.isFile()) {
        if (!extension || entry.name.endsWith(extension)) {
          count++;
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return count;
}

/**
 * Count .md files inside any Workflows directory
 */
function countWorkflowFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'workflows') {
          count += countFilesRecursive(fullPath, '.md');
        } else {
          count += countWorkflowFiles(fullPath);
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return count;
}

/**
 * Count skills (directories with SKILL.md file)
 * Returns total, public (no _ prefix), and private (_ prefix)
 */
function countSkills(_paiDir: string): { total: number; pub: number; priv: number } {
  let pub = 0;
  let priv = 0;
  const skillsDir = join(getClaudeDir(), 'skills');
  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      const isDir = entry.isDirectory() ||
        (entry.isSymbolicLink() && statSync(join(skillsDir, entry.name)).isDirectory());
      if (isDir) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillFile)) {
          if (entry.name.startsWith('_')) priv++;
          else pub++;
        }
      }
    }
  } catch {
    // skills directory doesn't exist
  }
  return { total: pub + priv, pub, priv };
}

/**
 * Count active hooks: unique commands registered under `hooks.<event>[].hooks[].command`
 * in settings.json. Dormant `.hook.ts` files on disk that aren't wired to any event do
 * NOT count — only what Claude Code will actually fire.
 */
function countHooks(_paiDir: string): number {
  const settingsPath = getSettingsPath();
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const events = settings.hooks ?? {};
    const unique = new Set<string>();
    for (const matchers of Object.values(events)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        const list = (matcher as { hooks?: unknown }).hooks;
        if (!Array.isArray(list)) continue;
        for (const h of list) {
          const cmd = (h as { command?: unknown }).command;
          if (typeof cmd === 'string' && cmd.length > 0) unique.add(cmd);
        }
      }
    }
    return unique.size;
  } catch {
    return 0;
  }
}

/**
 * Count non-empty lines in a JSONL file (signals = rating entries)
 */
function countRatingsLines(filePath: string): number {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return 0;
    return readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Count immediate subdirectories (depth 1)
 */
function countSubdirs(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * Get all counts
 */
function getCounts(paiDir: string): Counts {
  const ratingsPath = join(paiDir, 'MEMORY/LEARNING/SIGNALS/ratings.jsonl');
  const sk = countSkills(paiDir);
  return {
    skills: sk.total,
    skillsPublic: sk.pub,
    skillsPrivate: sk.priv,
    workflows: countWorkflowFiles(join(getClaudeDir(), 'skills')),
    hooks: countHooks(paiDir),
    signals: countFilesRecursive(join(paiDir, 'MEMORY/LEARNING'), '.md'),
    files: countFilesRecursive(join(paiDir, 'PAI/USER')),
    work: countSubdirs(join(paiDir, 'MEMORY/WORK')),
    sessions: countFilesRecursive(join(paiDir, 'MEMORY'), '.jsonl'),
    research: countFilesRecursive(join(paiDir, 'MEMORY/RESEARCH'), '.md') +
              countFilesRecursive(join(paiDir, 'MEMORY/RESEARCH'), '.json'),
    ratings: countRatingsLines(ratingsPath),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Resolve the Claude Code OAuth access token across platforms.
 *
 * - macOS  (darwin): macOS Keychain via the `security` CLI. UNCHANGED from
 *   the original implementation — byte-for-byte the same command + parse.
 * - Windows (win32): Windows Credential Manager via `keytar` (already a
 *   dependency in PAI/PULSE/package.json), then graceful fallback to the
 *   ~/.claude/.credentials.json file, then a CLAUDE_CODE_OAUTH_TOKEN env/.env.
 *   keytar is a native module — dynamic-import it so non-Windows never loads it.
 * - Linux  (else): ~/.claude/.credentials.json file. UNCHANGED.
 *
 * Returns the access token string, or null if none could be obtained.
 */
async function resolveOAuthToken(): Promise<string | null> {
  // ── macOS: unchanged Keychain path ──
  if (process.platform === 'darwin') {
    try {
      const credJson = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      return JSON.parse(credJson)?.claudeAiOauth?.accessToken ?? null;
    } catch {
      return null;
    }
  }

  // ── Windows: keytar → credentials file → env/.env ──
  if (process.platform === 'win32') {
    // 1. Windows Credential Manager via keytar (mirrors the macOS service name).
    try {
      const keytar = await import('keytar');
      const get = (keytar as any).default?.getPassword ?? (keytar as any).getPassword;
      if (typeof get === 'function') {
        const stored: string | null =
          (await get('Claude Code-credentials', process.env.USERNAME || 'default')) ??
          (await get('Claude Code-credentials', 'Claude Code-credentials'));
        if (stored) {
          try {
            return JSON.parse(stored)?.claudeAiOauth?.accessToken ?? stored;
          } catch {
            return stored; // raw token stored without JSON wrapper
          }
        }
      }
    } catch {
      /* keytar unavailable or no entry — fall through to file/.env */
    }

    // 2. Credentials file fallback (Claude Code may write it on Windows too).
    try {
      const credPath = join(homedir() || '', '.claude', '.credentials.json');
      if (existsSync(credPath)) {
        const credJson = readFileSync(credPath, 'utf-8').trim();
        const tok = JSON.parse(credJson)?.claudeAiOauth?.accessToken;
        if (tok) return tok;
      }
    } catch {
      /* fall through to env/.env */
    }

    // 3. Explicit env / ~/.claude/.env fallback.
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const envPath = join(getClaudeDir(), '.env');
      if (existsSync(envPath)) {
        const m = readFileSync(envPath, 'utf-8').match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m);
        if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      /* give up gracefully */
    }
    return null;
  }

  // ── Linux/other: unchanged credentials-file path ──
  try {
    const credPath = join(homedir() || '', '.claude', '.credentials.json');
    const credJson = readFileSync(credPath, 'utf-8').trim();
    return JSON.parse(credJson)?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh usage cache from Anthropic OAuth API.
 * Called by stop hook so status line never needs to make this 700ms API call.
 */
async function refreshUsageCache(paiDir: string): Promise<void> {
  const usageCachePath = join(paiDir, 'MEMORY/STATE/usage-cache.json');

  try {
    // Extract OAuth token cross-platform:
    //   macOS  → Keychain via `security` CLI (UNCHANGED)
    //   Windows→ Windows Credential Manager via keytar, then file/.env fallback
    //   Linux  → ~/.claude/.credentials.json (UNCHANGED)
    const token = await resolveOAuthToken();
    if (!token) return;

    const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) return;
    const data = await resp.json() as Record<string, unknown>;
    if (!data?.five_hour) return;

    // Fetch API workspace cost if admin key is available
    const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
    if (adminKey) {
      try {
        const now = new Date();
        const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00Z`;
        const costResp = await fetch(
          `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${startOfMonth}`,
          {
            headers: {
              'x-api-key': adminKey,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (costResp.ok) {
          const costData = await costResp.json() as any;
          // Sum all daily cost entries (amount is cents as decimal string)
          let totalCostCents = 0;
          if (Array.isArray(costData?.data)) {
            for (const day of costData.data) {
              if (Array.isArray(day?.results)) {
                for (const entry of day.results) {
                  totalCostCents += parseFloat(entry.amount || '0');
                }
              }
            }
          }
          (data as any).workspace_cost = {
            month_used_cents: Math.round(totalCostCents),
            updated_at: new Date().toISOString(),
          };
          console.error(`[UpdateCounts] Workspace cost: $${(totalCostCents / 100).toFixed(2)} this month`);
        }
      } catch {
        // Non-fatal — admin API unavailable
      }
    }

    writeFileSync(usageCachePath, JSON.stringify(data, null, 2) + '\n');
    console.error(`[UpdateCounts] Usage cache refreshed: 5H=${(data.five_hour as any)?.utilization}% 7D=${(data.seven_day as any)?.utilization}%`);
  } catch {
    // Non-fatal — status line falls back to stale cache
  }
}

/**
 * Handler called by UpdateCounts.hook.ts
 */
export async function handleUpdateCounts(): Promise<void> {
  const paiDir = getPaiDir();
  const settingsPath = getSettingsPath();

  try {
    // Run counts + usage refresh in parallel
    const [counts] = await Promise.all([
      Promise.resolve(getCounts(paiDir)),
      refreshUsageCache(paiDir),
    ]);

    // Read current settings
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Update counts section
    settings.counts = counts;

    // v6.2.0+: settings.pai.algorithmVersion was removed; LATEST is the single source
    // of truth and Banner / statusline / ArchitectureSummaryGenerator read it directly.
    // The CLAUDE.md → settings.json sync that lived here is no longer needed.

    // Write back
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.error(`[UpdateCounts] Updated: SK:${counts.skillsPublic}pu/${counts.skillsPrivate}pv WF:${counts.workflows} HK:${counts.hooks} SIG:${counts.signals} F:${counts.files} W:${counts.work} SESS:${counts.sessions} RES:${counts.research} RAT:${counts.ratings}`);
  } catch (error) {
    console.error('[UpdateCounts] Failed to update counts:', error);
    // Non-fatal - don't throw, let other handlers continue
  }
}

// Allow running standalone to seed initial counts
if (import.meta.main) {
  handleUpdateCounts().then(() => process.exit(0));
}
