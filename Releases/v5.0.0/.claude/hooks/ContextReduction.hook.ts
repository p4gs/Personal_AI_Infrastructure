#!/usr/bin/env bun
/**
 * ContextReduction.hook.ts — RTK auto-rewrite hook for Claude Code PreToolUse:Bash
 *
 * TypeScript port of ContextReduction.hook.sh.
 * Transparently rewrites raw commands to their rtk equivalents.
 *
 * Input:  JSON from stdin (Claude Code hook protocol)
 * Output: JSON with hookSpecificOutput.updatedInput when a rewrite applies,
 *         or exits 0 with no output when no rewrite is needed.
 */

import { execSync } from "child_process"
import { join } from "path"
import { getTempDir } from "../lib/platform"
import { readStdinWithTimeout } from "./lib/stdin"

// Guards: skip silently if rtk not available
function commandExists(cmd: string): boolean {
  try {
    execSync(`${process.platform === "win32" ? "where" : "command -v"} ${cmd}`, {
      stdio: "ignore",
      timeout: 2000,
    })
    return true
  } catch {
    return false
  }
}

if (!commandExists("rtk")) {
  process.exit(0)
}

// Read stdin (cross-platform: process.stdin, not Bun.stdin)
const inputRaw = await readStdinWithTimeout()

let input: Record<string, unknown>
try {
  input = JSON.parse(inputRaw)
} catch {
  process.exit(0)
}

const toolInput = input.tool_input as Record<string, unknown> | undefined
const CMD: string = (toolInput?.command as string) ?? ""

if (!CMD) process.exit(0)

// Skip heredocs
if (CMD.includes("<<")) process.exit(0)

// Skip multi-line scripts
if (CMD.includes("\n")) process.exit(0)

// Skip if already using rtk
if (/^rtk\s|\/rtk\s/.test(CMD)) process.exit(0)

// Strip leading env var assignments for pattern matching
// e.g., "NODE_ENV=production npx vitest run" → match "npx vitest run"
const envPrefixMatch = CMD.match(/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)+/)
const ENV_PREFIX = envPrefixMatch ? envPrefixMatch[0] : ""
const MATCH_CMD = CMD.slice(ENV_PREFIX.length)
const CMD_BODY = CMD.slice(ENV_PREFIX.length)

let rewritten = ""

// ─── Git commands ───────────────────────────────────────────────────────
if (/^git[\s]/.test(MATCH_CMD)) {
  const gitSub = MATCH_CMD
    .replace(/^git\s+/, "")
    .replace(/(-C|-c)\s+\S+\s*/g, "")
    .replace(/--[\w-]+=\S+\s*/g, "")
    .replace(/--(no-pager|no-optional-locks|bare|literal-pathspecs)\s*/g, "")
    .replace(/^\s+/, "")

  if (/^(status|diff|log|add|commit|push|pull|branch|fetch|stash|show)(\s|$)/.test(gitSub)) {
    rewritten = ENV_PREFIX + "rtk " + CMD_BODY
  }

// ─── GitHub CLI ────────────────────────────────────────────────────────
} else if (/^gh\s+(pr|issue|run|api|release)(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^gh /, "rtk gh ")

// ─── Cargo ─────────────────────────────────────────────────────────────
} else if (/^cargo\s/.test(MATCH_CMD)) {
  const cargoSub = MATCH_CMD.replace(/^cargo\s+(\+\S+\s+)?/, "")
  if (/^(test|build|clippy|check|install|fmt)(\s|$)/.test(cargoSub)) {
    rewritten = ENV_PREFIX + "rtk " + CMD_BODY
  }

// ─── File operations ────────────────────────────────────────────────────
} else if (/^cat\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^cat /, "rtk read ")

} else if (/^(rg|grep)\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(rg|grep) /, "rtk grep ")

} else if (/^ls(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^ls/, "rtk ls")

} else if (/^tree(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^tree/, "rtk tree")

} else if (/^find\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^find /, "rtk find ")

} else if (/^diff\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^diff /, "rtk diff ")

} else if (/^head\s+/.test(MATCH_CMD)) {
  const headMatch = MATCH_CMD.match(/^head\s+-(\d+)\s+(.+)$/)
  const headMatch2 = MATCH_CMD.match(/^head\s+--lines=(\d+)\s+(.+)$/)
  if (headMatch) {
    rewritten = `${ENV_PREFIX}rtk read ${headMatch[2]} --max-lines ${headMatch[1]}`
  } else if (headMatch2) {
    rewritten = `${ENV_PREFIX}rtk read ${headMatch2[2]} --max-lines ${headMatch2[1]}`
  }

// ─── JS/TS tooling ──────────────────────────────────────────────────────
} else if (/^(pnpm\s+)?(npx\s+)?vitest(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(pnpm )?(npx )?vitest( run)?/, "rtk vitest run")

} else if (/^pnpm\s+test(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^pnpm test/, "rtk vitest run")

} else if (/^npm\s+test(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^npm test/, "rtk npm test")

} else if (/^npm\s+run\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^npm run /, "rtk npm ")

} else if (/^(npx\s+)?vue-tsc(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(npx )?vue-tsc/, "rtk tsc")

} else if (/^pnpm\s+tsc(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^pnpm tsc/, "rtk tsc")

} else if (/^(npx\s+)?tsc(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(npx )?tsc/, "rtk tsc")

} else if (/^pnpm\s+lint(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^pnpm lint/, "rtk lint")

} else if (/^(npx\s+)?eslint(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(npx )?eslint/, "rtk lint")

} else if (/^(npx\s+)?prettier(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(npx )?prettier/, "rtk prettier")

} else if (/^(npx\s+)?prisma(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^(npx )?prisma/, "rtk prisma")

// ─── Containers ─────────────────────────────────────────────────────────
} else if (/^docker\s/.test(MATCH_CMD)) {
  if (/^docker\s+compose(\s|$)/.test(MATCH_CMD)) {
    const composeSub = MATCH_CMD.replace(/^docker\s+compose\s*/, "")
    if (/^(ps|logs|build)(\s|$)/.test(composeSub)) {
      rewritten = ENV_PREFIX + CMD_BODY.replace(/^docker /, "rtk docker ")
    }
  } else {
    const dockerSub = MATCH_CMD
      .replace(/^docker\s+/, "")
      .replace(/(-H|--context|--config)\s+\S+\s*/g, "")
      .replace(/--[\w-]+=\S+\s*/g, "")
      .replace(/^\s+/, "")
    if (/^(ps|images|logs|run|build|exec)(\s|$)/.test(dockerSub)) {
      rewritten = ENV_PREFIX + CMD_BODY.replace(/^docker /, "rtk docker ")
    }
  }

} else if (/^kubectl\s/.test(MATCH_CMD)) {
  const kubeSub = MATCH_CMD
    .replace(/^kubectl\s+/, "")
    .replace(/(--context|--kubeconfig|--namespace|-n)\s+\S+\s*/g, "")
    .replace(/--[\w-]+=\S+\s*/g, "")
    .replace(/^\s+/, "")
  if (/^(get|logs|describe|apply)(\s|$)/.test(kubeSub)) {
    rewritten = ENV_PREFIX + CMD_BODY.replace(/^kubectl /, "rtk kubectl ")
  }

// ─── Network ────────────────────────────────────────────────────────────
} else if (/^curl\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^curl /, "rtk curl ")

} else if (/^wget\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^wget /, "rtk wget ")

// ─── pnpm package management ────────────────────────────────────────────
} else if (/^pnpm\s+(list|ls|outdated)(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^pnpm /, "rtk pnpm ")

// ─── Python tooling ─────────────────────────────────────────────────────
} else if (/^pytest(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^pytest/, "rtk pytest")

} else if (/^python\s+-m\s+pytest(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^python -m pytest/, "rtk pytest")

} else if (/^ruff\s+(check|format)(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^ruff /, "rtk ruff ")

} else if (/^pip\s+(list|outdated|install|show)(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^pip /, "rtk pip ")

} else if (/^uv\s+pip\s+(list|outdated|install|show)(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^uv pip /, "rtk pip ")

} else if (/^mypy(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^mypy/, "rtk mypy")

} else if (/^python\s+-m\s+mypy(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^python -m mypy/, "rtk mypy")

// ─── Go tooling ─────────────────────────────────────────────────────────
} else if (/^go\s+test(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^go test/, "rtk go test")

} else if (/^go\s+build(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^go build/, "rtk go build")

} else if (/^go\s+vet(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^go vet/, "rtk go vet")

} else if (/^golangci-lint(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^golangci-lint/, "rtk golangci-lint")

// ─── AWS CLI ────────────────────────────────────────────────────────────
} else if (/^aws\s+/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^aws /, "rtk aws ")

// ─── PostgreSQL ─────────────────────────────────────────────────────────
} else if (/^psql(\s|$)/.test(MATCH_CMD)) {
  rewritten = ENV_PREFIX + CMD_BODY.replace(/^psql/, "rtk psql")

// ─── interceptor screenshot --save ──────────────────────────────────────
} else if (/^interceptor\s+screenshot(\s|$)/.test(MATCH_CMD) && MATCH_CMD.includes("--save")) {
  // Route the temp dir through the cross-platform abstraction:
  // getTempDir() === /tmp on Unix (behavior preserved) and %TEMP% on Windows.
  const screenshotDir = join(getTempDir(), "pai-screenshots")
  rewritten = ENV_PREFIX + `mkdir -p "${screenshotDir}" && ( cd "${screenshotDir}" && ${CMD_BODY} )`
}

// ─── No rewrite needed ──────────────────────────────────────────────────
if (!rewritten) {
  process.exit(0)
}

// ─── Output rewrite instruction ─────────────────────────────────────────
const updatedInput = { ...(toolInput ?? {}), command: rewritten }

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "RTK auto-rewrite",
    updatedInput,
  },
}

process.stdout.write(JSON.stringify(output))
