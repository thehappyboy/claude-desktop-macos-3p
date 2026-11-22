#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = { profile: "Claude-3p", mode: "full_control" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") out.profile = argv[++i];
    else if (arg === "--mode") out.mode = argv[++i];
    else if (arg === "-h" || arg === "--help") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["full_control", "background"].includes(out.mode)) {
    throw new Error(`--mode must be full_control or background, got ${out.mode}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/configure-3p.mjs [--profile Claude-3p] [--mode full_control|background]");
    return;
  }
  const config = path.join(
    homedir(),
    "Library",
    "Application Support",
    args.profile,
    "claude_desktop_config.json",
  );
  if (!existsSync(config)) {
    throw new Error(`3P config not found: ${config}`);
  }
  const data = JSON.parse(readFileSync(config, "utf8"));
  const preferences = data.preferences && typeof data.preferences === "object"
    ? data.preferences
    : {};
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const backup = `${config}.bak-${stamp}`;
  writeFileSync(backup, readFileSync(config), { mode: 0o600 });
  preferences.chicagoEnabled = true;
  preferences.chicagoAutoUnhide = true;
  preferences.chicagoPreferredMode = args.mode;
  data.preferences = preferences;
  writeFileSync(config, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  execFileSync("/bin/chmod", ["600", config]);
  console.log(`[configure] ${config}`);
  console.log(`[configure] chicagoEnabled=true chicagoPreferredMode=${args.mode}`);
  console.log(`[configure] backup ${backup}`);

  // The 3P SPA keeps its applied inference profile in configLibrary, not in
  // claude_desktop_config.json. disableAutoUpdates must be written there or a
  // fresh profile can replace the signed/patched app on the next update.
  const configLibrary = path.join(path.dirname(config), "configLibrary");
  const metaPath = path.join(configLibrary, "_meta.json");
  if (!existsSync(metaPath)) {
    console.warn(
      `[configure] ${metaPath} not found; launch Claude-3p once, then rerun this command to disable auto-updates`,
    );
    return;
  }

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${metaPath}: ${error.message}`);
  }
  const appliedId = typeof meta.appliedId === "string" ? meta.appliedId : "";
  if (!appliedId) {
    throw new Error(`No appliedId in ${metaPath}; cannot locate the applied 3P config`);
  }
  const appliedConfig = path.join(configLibrary, `${appliedId}.json`);
  if (!existsSync(appliedConfig)) {
    throw new Error(`Applied 3P config not found: ${appliedConfig}`);
  }

  const appliedBackup = `${appliedConfig}.bak-${stamp}`;
  const appliedBytes = readFileSync(appliedConfig);
  writeFileSync(appliedBackup, appliedBytes, { mode: 0o600 });
  let applied;
  try {
    applied = JSON.parse(appliedBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${appliedConfig}: ${error.message}`);
  }
  applied.disableAutoUpdates = true;
  writeFileSync(appliedConfig, `${JSON.stringify(applied, null, 2)}\n`, { mode: 0o600 });
  execFileSync("/bin/chmod", ["600", appliedConfig]);
  console.log(`[configure] ${appliedConfig}`);
  console.log("[configure] disableAutoUpdates=true");
  console.log(`[configure] backup ${appliedBackup}`);
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
