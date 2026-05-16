/**
 * displayPath.ts — Cross-platform path display normalization
 *
 * Converts Windows backslash paths to forward slashes for display purposes.
 * Use for log messages, UI labels, and user-facing output — NOT for filesystem operations.
 * For filesystem operations always use path.join() / path.resolve() directly.
 */

/**
 * Normalize a filesystem path to forward slashes for display.
 * On macOS/Linux this is a no-op. On Windows it converts \ to /.
 *
 * @param p - The path to normalize for display
 * @returns The path with all backslashes replaced by forward slashes
 */
export function displayPath(p: string): string {
  if (process.platform !== "win32") return p
  return p.replace(/\\/g, "/")
}
