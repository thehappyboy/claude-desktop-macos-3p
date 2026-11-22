import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "configure-3p.mjs");

test("configure-3p writes the applied auto-update policy and backs up both files", () => {
  const home = mkdtempSync(path.join(tmpdir(), "claude3p-configure-"));
  const profile = path.join(home, "Library", "Application Support", "Claude-3p");
  const library = path.join(profile, "configLibrary");
  mkdirSync(library, { recursive: true });
  const mainPath = path.join(profile, "claude_desktop_config.json");
  const metaPath = path.join(library, "_meta.json");
  const appliedPath = path.join(library, "test-config.json");
  writeFileSync(mainPath, JSON.stringify({ deploymentMode: "3p", preferences: {} }));
  writeFileSync(metaPath, JSON.stringify({ appliedId: "test-config", entries: [] }));
  writeFileSync(appliedPath, JSON.stringify({ inferenceProvider: "gateway", disableAutoUpdates: false }));

  try {
    const result = spawnSync(process.execPath, [SCRIPT, "--mode", "background"], {
      cwd: ROOT,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const main = JSON.parse(readFileSync(mainPath, "utf8"));
    const applied = JSON.parse(readFileSync(appliedPath, "utf8"));
    assert.equal(main.preferences.chicagoEnabled, true);
    assert.equal(main.preferences.chicagoPreferredMode, "background");
    assert.equal(applied.disableAutoUpdates, true);
    assert.ok(readdirSync(path.dirname(mainPath)).some((name) => name.includes(".bak-")));
    assert.ok(readdirSync(library).some((name) => name.includes(".bak-")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
