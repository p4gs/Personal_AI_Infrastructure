#!/usr/bin/env bun
/**
 * findChrome.ts — Cross-platform Chrome/Chromium path resolver
 *
 * Uses chrome-launcher for cross-platform detection. Falls back to common
 * platform-specific paths if chrome-launcher is unavailable.
 */

import { existsSync } from "node:fs"

/**
 * Find the Chrome/Chromium executable path on the current platform.
 * Returns the path string, or null if not found.
 */
export async function findChrome(): Promise<string | null> {
  // Try chrome-launcher first (most reliable, cross-platform)
  try {
    const chromeLauncher = await import("chrome-launcher")
    const installations = chromeLauncher.default.getInstallations()
    if (installations.length > 0) return installations[0]
  } catch { /* chrome-launcher not installed — fall through */ }

  // Platform-specific fallbacks
  const platform = process.platform

  if (platform === "win32") {
    const candidates = [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
    for (const p of candidates) {
      if (p && existsSync(p)) return p
    }
  } else if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
  } else {
    // Linux
    const { execSync } = await import("node:child_process")
    for (const cmd of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      try {
        const path = execSync(`which ${cmd}`, { encoding: "utf-8", timeout: 2000 }).trim()
        if (path) return path
      } catch { /* not found */ }
    }
  }

  return null
}

// CLI usage: bun findChrome.ts
if (import.meta.main) {
  const chromePath = await findChrome()
  if (chromePath) {
    console.log(chromePath)
    process.exit(0)
  } else {
    console.error("Chrome/Chromium not found")
    process.exit(1)
  }
}
