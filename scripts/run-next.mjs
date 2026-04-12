#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveRuntimePorts, withRuntimePortEnv } from "./runtime-env.mjs";
import { bootstrapEnv } from "./bootstrap-env.mjs";
import { movePath } from "./build-next-isolated.mjs";

const mode = process.argv[2] === "start" ? "start" : "dev";
const projectRoot = process.cwd();
const legacyAppDir = path.join(projectRoot, "app");
const srcAppDir = path.join(projectRoot, "src", "app");
const backupDir = path.join(projectRoot, `.app-dev-backup-${process.pid}-${Date.now()}`);

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function shouldMoveLegacyAppDir() {
  return (await exists(legacyAppDir)) && (await exists(srcAppDir));
}

async function restoreLegacyAppDir() {
  if ((await exists(backupDir)) && !(await exists(legacyAppDir))) {
    await movePath(backupDir, legacyAppDir);
  }
}

function runChild(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);

    const forward = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);

    child.on("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolve({ code: code ?? 0, signal: signal ?? null });
    });
  });
}

let movedLegacyApp = false;

try {
  if (mode === "dev" && (await shouldMoveLegacyAppDir())) {
    await movePath(legacyAppDir, backupDir);
    movedLegacyApp = true;
    console.log("[run-next] Temporarily moved legacy app/ out of the way for dev mode");
  }

  const env = bootstrapEnv();
  const runtimePorts = resolveRuntimePorts(env);
  const { dashboardPort } = runtimePorts;

  const args = ["./node_modules/next/dist/bin/next", mode, "--port", String(dashboardPort)];

  // Default: use Turbopack in dev. This codebase uses Tailwind v4 / CSS imports that compile
  // correctly under Turbopack, while the webpack dev path stalls on src/app/globals.css.
  // Set OMNIROUTE_USE_WEBPACK=1 in .env only if you explicitly need the legacy dev compiler.
  if (mode === "dev" && env.OMNIROUTE_USE_WEBPACK === "1") {
    args.splice(2, 0, "--webpack");
  }

  const result = await runChild(process.execPath, args, {
    stdio: "inherit",
    env: withRuntimePortEnv(env, runtimePorts),
  });

  if (movedLegacyApp) {
    try {
      await restoreLegacyAppDir();
    } catch (restoreError) {
      console.error("[run-next] Failed to restore legacy app dir:", restoreError);
    }
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }

  process.exit(result.code);
} catch (error) {
  console.error("[run-next] Failed to start Next.js:", error);

  if (movedLegacyApp) {
    try {
      await restoreLegacyAppDir();
    } catch (restoreError) {
      console.error(
        "[run-next] Failed to restore legacy app dir after startup failure:",
        restoreError
      );
    }
  }

  process.exit(1);
}
