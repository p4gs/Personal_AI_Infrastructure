/**
 * credentials.ts — Cross-platform credential storage helper
 *
 * Wraps keytar (Windows Credential Manager / macOS Keychain / Linux Secret Service)
 * with a .env file fallback for environments where keytar isn't available.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const SERVICE_NAME = "PAI"

/**
 * Get a credential by key.
 * Priority: keytar → .env file fallback → null
 */
export async function getCredential(key: string): Promise<string | null> {
  // Try keytar first (Windows Credential Manager / macOS Keychain / Linux keyring)
  try {
    const keytar = await import("keytar")
    const value = await keytar.default.getPassword(SERVICE_NAME, key)
    if (value !== null) return value
  } catch {
    // keytar not available or failed — fall through to .env
  }

  // .env file fallback
  const envPath = join(homedir(), ".claude", ".env")
  if (existsSync(envPath)) {
    try {
      const lines = readFileSync(envPath, "utf-8").split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith("#") || !trimmed.includes("=")) continue
        const eqIdx = trimmed.indexOf("=")
        const envKey = trimmed.slice(0, eqIdx).trim()
        if (envKey === key) {
          let val = trimmed.slice(eqIdx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          return val || null
        }
      }
    } catch { /* silent */ }
  }

  // Process env fallback
  return process.env[key] ?? null
}

/**
 * Set a credential by key.
 * Stores in keytar if available, otherwise warns that .env must be edited manually.
 */
export async function setCredential(key: string, value: string): Promise<boolean> {
  try {
    const keytar = await import("keytar")
    await keytar.default.setPassword(SERVICE_NAME, key, value)
    return true
  } catch {
    // keytar not available
    console.warn(`[credentials] keytar unavailable — please set ${key} in ~/.claude/.env manually`)
    return false
  }
}

/**
 * Delete a credential by key.
 */
export async function deleteCredential(key: string): Promise<boolean> {
  try {
    const keytar = await import("keytar")
    return await keytar.default.deletePassword(SERVICE_NAME, key)
  } catch {
    return false
  }
}
