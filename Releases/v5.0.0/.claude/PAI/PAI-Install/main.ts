#!/usr/bin/env bun
/**
 * PAI Installer v5.0 — Main Entry Point
 * Routes to CLI, Web server (for Electron), or GUI (Electron app).
 *
 * Modes:
 *   --mode cli   → Interactive terminal wizard
 *   --mode web   → Start HTTP/WebSocket server (used internally by Electron)
 *   --mode gui   → Launch Electron app (which spawns web mode internally)
 */

import { spawn, spawnSync, execSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

const args = process.argv.slice(2);
const modeIdx = args.indexOf("--mode");
const mode = modeIdx >= 0 ? args[modeIdx + 1] : "gui";

const ROOT = import.meta.dir;

async function main() {
  if (mode === "cli") {
    // Run CLI wizard
    const { runCLI } = await import("./cli/index");
    await runCLI();
  } else if (mode === "web") {
    // Start the HTTP + WebSocket server (Electron loads this)
    await import("./web/server");
  } else {
    // Launch Electron GUI app
    const electronDir = join(ROOT, "electron");
    const electronPkg = join(electronDir, "node_modules", ".package-lock.json");

    // Install electron dependencies if needed.
    // bun is the bootstrap runtime install.sh guarantees; npm is NOT on a
    // bun-only host. Using bun install here keeps the GUI path reachable
    // for the typical PAI user.
    if (!existsSync(electronPkg)) {
      console.log("Installing GUI dependencies (first run only)...\n");
      const install = spawnSync("bun", ["install"], {
        cwd: electronDir,
        stdio: "inherit",
      });
      if (install.status !== 0) {
        console.error("Failed to install GUI dependencies. Falling back to CLI...\n");
        const { runCLI } = await import("./cli/index");
        await runCLI();
        return;
      }
    }

    // Verify the platform-specific Electron binary exists.
    // `bun install --no-changes` skips postinstall scripts, so the binary may
    // be missing or wrong-platform (e.g. Linux binary downloaded under WSL,
    // then re-run on native Windows). Re-run install.js to fix it.
    const electronBinName = process.platform === "win32" ? "electron.exe" : "electron";
    const electronBin = join(electronDir, "node_modules", "electron", "dist", electronBinName);
    if (!existsSync(electronBin)) {
      console.log(`Electron binary not found for ${process.platform}. Downloading...\n`);
      const download = spawnSync(process.execPath, ["node_modules/electron/install.js"], {
        cwd: electronDir,
        stdio: "inherit",
      });
      if (download.status !== 0 || !existsSync(electronBin)) {
        console.error("\nFailed to download Electron binary. Falling back to CLI installer...\n");
        const { runCLI } = await import("./cli/index");
        await runCLI();
        return;
      }
    }

    // Clear macOS quarantine flags (prevents "app is damaged" error on copied installs)
    if (process.platform === "darwin") {
      try {
        execSync(`xattr -cr "${electronDir}"`, { stdio: "pipe", timeout: 30000 });
        console.log("Cleared macOS quarantine flags.\n");
      } catch {
        // Non-fatal
      }
    }

    console.log("Starting PAI Installer GUI...\n");
    const child = spawn("bun", ["run", "start"], {
      cwd: electronDir,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(`\nElectron exited with code ${code}. Falling back to CLI installer...\n`);
        import("./cli/index").then(({ runCLI }) => runCLI()).catch((err) => {
          console.error("CLI fallback failed:", err.message);
          process.exit(1);
        });
      } else {
        process.exit(0);
      }
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
