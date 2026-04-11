#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveRuntimePorts,
  withRuntimePortEnv,
  spawnWithForwardedSignals,
} from "./runtime-env.mjs";
import { bootstrapEnv } from "./bootstrap-env.mjs";
import { movePath } from "./build-next-isolated.mjs";

const mode = process.argv[2] === "start" ? "start" : "dev";
const projectRoot = process.cwd();
const legacyAppDir = path.join(projectRoot, "app");
const backupDir = path.join(projectRoot, `.app-dev-backup-${process.pid}-${Date.now()}`);

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

// Load .env / server.env first so PORT / DASHBOARD_PORT from files affect --port below.
const env = bootstrapEnv();
const runtimePorts = resolveRuntimePorts(env);
const { dashboardPort } = runtimePorts;

const args = ["./node_modules/next/dist/bin/next", mode, "--port", String(dashboardPort)];
// Default: use Turbopack in dev. This codebase uses Tailwind v4 / CSS imports that compile
// correctly under Turbopack, while the webpack dev path stalls on src/app/globals.css.
// Set OMNIROUTE_USE_WEBPACK=1 in .env only if you explicitly need the legacy dev compiler.
// Must read merged `env` from bootstrap — .env is not applied to process.env in the launcher.
if (mode === "dev" && env.OMNIROUTE_USE_WEBPACK === "1") {
  args.splice(2, 0, "--webpack");
}

let movedLegacyApp = false;
try {
  // Dev mode has the same route-discovery problem as build mode: the legacy top-level
  // `app/` snapshot conflicts with the real Next.js source in `src/app/`. Move it out
  // of the way before starting Next, then restore it on exit.
  if (mode === "dev" && (await exists(legacyAppDir))) {
    await movePath(legacyAppDir, backupDir);
    movedLegacyApp = true;
  }

  const child = spawnWithForwardedSignals(process.execPath, args, {
    stdio: "inherit",
    env: withRuntimePortEnv(env, runtimePorts),
  });

  const restore = async () => {
    if (movedLegacyApp && (await exists(backupDir))) {
      try {
        await movePath(backupDir, legacyAppDir);
      } catch (error) {
        console.error("[run-next] Failed to restore legacy app dir:", error);
      }
    }
  };

  child.on("exit", () => {
    void restore();
  });
} catch (error) {
  console.error("[run-next] Failed to start Next.js:", error);
  if (movedLegacyApp && (await exists(backupDir))) {
    await movePath(backupDir, legacyAppDir);
  }
  process.exit(1);
}
