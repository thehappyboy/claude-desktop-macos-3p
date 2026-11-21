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
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
