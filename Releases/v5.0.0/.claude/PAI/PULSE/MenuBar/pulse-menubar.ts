#!/usr/bin/env bun
/**
 * pulse-menubar.ts — Windows system tray icon for PAI Pulse
 *
 * Creates a tray icon with menu items: Status, Open Logs, Restart Pulse, Quit.
 * Uses systray2 for cross-platform tray support.
 *
 * Usage: bun run pulse-menubar.ts
 * Or launch it from start-pulse.ps1 as a companion process.
 */

import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync } from "node:fs"
import { execSync, spawn } from "node:child_process"

const PULSE_PORT = 31337
const LOG_FILE = join(homedir(), ".claude", "MEMORY", "OBSERVABILITY", "pulse-events.jsonl")
const ICON_PATH = join(import.meta.dir, "pulse.ico")

async function getPulseStatus(): Promise<string> {
  try {
    const resp = await fetch(`http://localhost:${PULSE_PORT}/api/pulse/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (resp.ok) return "Running"
    return "Error"
  } catch {
    return "Not Running"
  }
}

async function restartPulse(): Promise<void> {
  const manageScript = join(homedir(), ".claude", "PAI", "PULSE", "manage.ps1")
  if (existsSync(manageScript)) {
    spawn("powershell.exe", ["-NoProfile", "-File", manageScript, "restart"], {
      detached: true,
      stdio: "ignore",
    }).unref()
  }
}

function openLogs(): void {
  if (existsSync(LOG_FILE)) {
    spawn("notepad.exe", [LOG_FILE], { detached: true, stdio: "ignore" }).unref()
  } else {
    spawn("powershell.exe", ["-NoProfile", "-Command",
      `[System.Windows.MessageBox]::Show('Log file not found: ${LOG_FILE}', 'PAI Pulse')`
    ], { detached: true, stdio: "ignore" }).unref()
  }
}

async function main() {
  // Dynamically import systray2 — optional dependency
  let SysTray: typeof import("systray2").default
  try {
    const mod = await import("systray2")
    SysTray = mod.default
  } catch (err) {
    console.error("[pulse-menubar] systray2 not installed — run: bun install")
    console.error("  in:", join(import.meta.dir, ".."))
    process.exit(1)
  }

  const status = await getPulseStatus()
  const iconPath = existsSync(ICON_PATH) ? ICON_PATH : ""

  const tray = new SysTray({
    menu: {
      icon: iconPath,
      title: "PAI Pulse",
      tooltip: `PAI Pulse — ${status}`,
      items: [
        {
          title: `Status: ${status}`,
          tooltip: "Current Pulse status",
          enabled: false,
          checked: false,
        },
        SysTray.separator,
        {
          title: "Open Logs",
          tooltip: "Open pulse event log in Notepad",
          enabled: true,
          checked: false,
        },
        {
          title: "Restart Pulse",
          tooltip: "Stop and restart the Pulse daemon",
          enabled: true,
          checked: false,
        },
        SysTray.separator,
        {
          title: "Quit Tray",
          tooltip: "Close this tray icon (Pulse keeps running)",
          enabled: true,
          checked: false,
        },
      ],
    },
    debug: false,
    copyDir: true,
  })

  tray.onClick((action) => {
    const item = action.seq_id
    switch (item) {
      case 2: // Open Logs
        openLogs()
        break
      case 3: // Restart Pulse
        restartPulse()
        break
      case 5: // Quit Tray
        tray.kill()
        process.exit(0)
        break
    }
  })

  // Refresh status tooltip every 30s
  setInterval(async () => {
    const newStatus = await getPulseStatus()
    try {
      tray.sendAction({
        type: "update-item",
        item: { title: `Status: ${newStatus}` },
        seq_id: 0,
      })
    } catch { /* ignore update errors */ }
  }, 30_000)

  console.error("[pulse-menubar] Tray icon active")
}

main().catch((err) => {
  console.error("[pulse-menubar] Fatal error:", err)
  process.exit(1)
})
