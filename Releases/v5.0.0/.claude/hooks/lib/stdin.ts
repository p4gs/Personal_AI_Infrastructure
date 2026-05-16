/**
 * stdin.ts — Cross-platform stdin reading utility for hooks
 *
 * Replaces duplicated Bun.stdin patterns across all hooks.
 * Uses process.stdin (not Bun.stdin) for Windows compatibility.
 *
 * Bun.stdin.text() and Bun.stdin.stream().getReader() fail silently
 * or hang indefinitely on Windows — returning empty strings or never
 * resolving. process.stdin with event listeners works reliably on all
 * platforms (macOS/Linux behavior is byte-identical to the prior code).
 *
 * Ported from: Releases/v3.0/.claude/hooks/lib/stdin.ts (proven, test-passing)
 * See: https://github.com/danielmiessler/Personal_AI_Infrastructure/issues/385
 * Part of: Windows 11 v5.0.0 support
 */

/**
 * Read all of stdin with a timeout fallback.
 * Returns whatever data was received before the timeout, or '' on error.
 *
 * This is the single cross-platform primitive every hook should use instead
 * of Bun.stdin. The hook I/O contract is preserved: stdin JSON in, the caller
 * still parses and writes stdout/stderr exactly as before.
 *
 * @param timeoutMs - Maximum time to wait for stdin (default: 500ms)
 */
export function readStdinWithTimeout(timeoutMs = 500): Promise<string> {
  return new Promise<string>((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      try { process.stdin.destroy(); } catch { /* already closed */ }
      resolve(data);
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

/**
 * Read stdin and JSON.parse it. Returns null if stdin is empty, the read
 * times out, or the payload is not valid JSON — matching the prior
 * try/catch-then-continue contract every hook relied on.
 *
 * @param timeoutMs - Maximum time to wait for stdin (default: 500ms)
 */
export async function readStdinJson<T = unknown>(timeoutMs = 500): Promise<T | null> {
  try {
    const raw = await readStdinWithTimeout(timeoutMs);
    if (raw.trim()) {
      return JSON.parse(raw) as T;
    }
  } catch {
    /* timeout / malformed JSON — caller continues with null */
  }
  return null;
}

/**
 * Drain and discard stdin (some hooks must consume the pipe per the Claude
 * Code hook contract but do not need the payload). Always resolves.
 *
 * @param timeoutMs - Maximum time to wait before giving up (default: 200ms)
 */
export async function drainStdin(timeoutMs = 200): Promise<void> {
  await readStdinWithTimeout(timeoutMs);
}
