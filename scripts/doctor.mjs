#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = {
  app: "/Applications/Claude-3p.app",
  profile: "Claude-3p",
  sourceApp: "/Applications/Claude.app",
  json: false,
};
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--app") args.app = process.argv[++i];
  else if (arg === "--profile") args.profile = process.argv[++i];
  else if (arg === "--source-app") args.sourceApp = process.argv[++i];
  else if (arg === "--json") args.json = true;
  else if (arg === "-h" || arg === "--help") {
    console.log("Usage: node scripts/doctor.mjs [--app /Applications/Claude-3p.app] [--source-app /Applications/Claude.app] [--profile Claude-3p] [--json]");
    process.exit(0);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

const app = path.resolve(args.app);
const sourceApp = path.resolve(args.sourceApp);
const checks = [];
function check(name, status, detail) {
  checks.push({ name, status, detail });
}
function pass(name, detail) { check(name, "PASS", detail); }
function warn(name, detail) { check(name, "WARN", detail); }
function fail(name, detail) { check(name, "FAIL", detail); }
function run(cmd, cmdArgs, options = {}) {
  try {
    return execFileSync(cmd, cmdArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      ...options,
    }).trim();
  } catch {
    return null;
  }
}
function runCombined(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  return `${r.stdout || ""}${r.stderr || ""}`.trim();
}
function plist(file) {
  const out = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", file]);
  return out ? JSON.parse(out) : null;
}
function tail(file, maxBytes = 1_500_000) {
  if (!existsSync(file)) return "";
  const b = readFileSync(file);
  return b.subarray(Math.max(0, b.length - maxBytes)).toString("utf8");
}
function lastMatch(text, re) {
  let found = null;
  for (const m of text.matchAll(re)) found = m;
  return found;
}
function tccAuth(service, client) {
  const dbs = [
    "/Library/Application Support/com.apple.TCC/TCC.db",
    path.join(homedir(), "Library", "Application Support", "com.apple.TCC", "TCC.db"),
  ];
  let result = { state: "unknown", detail: "TCC database not found" };
  for (const db of dbs) {
    if (!existsSync(db)) continue;
    const probe = spawnSync("/usr/bin/sqlite3", [
      db,
      `select auth_value from access where service='${service}' and client='${client}' order by last_modified desc limit 1;`,
    ], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) {
      if (result.state === "unknown") result = { state: "unknown", detail: "TCC database unreadable" };
      continue;
    }
    const value = String(probe.stdout || "").trim();
    if (value === "") {
      if (result.state === "unknown") result = { state: "unknown", detail: "no TCC row" };
      continue;
    }
    const auth = Number(value);
    if (auth === 2) return { state: "granted", detail: "TCC" };
    if (auth === 0) {
      result = { state: "denied", detail: "TCC" };
      continue;
    }
    result = { state: "unknown", detail: `unexpected auth_value=${value}` };
  }
  return result;
}

const infoPlist = path.join(app, "Contents", "Info.plist");
const asarPath = path.join(app, "Contents", "Resources", "app.asar");
const framework = path.join(app, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Electron Framework");
const ionAsar = path.join(app, "Contents", "Resources", "ion-dist.asar");
const configPath = path.join(homedir(), "Library", "Application Support", args.profile, "claude_desktop_config.json");
const logsDir = path.join(homedir(), "Library", "Logs", args.profile);
const mainLog = path.join(logsDir, "main.log");
const vmLog = path.join(logsDir, "cowork_vm_node.log");
const swiftLog = path.join(logsDir, "swift.log");

if (!existsSync(infoPlist) || !existsSync(asarPath)) {
  fail("app", `not a Claude app bundle: ${app}`);
} else {
  pass("app", app);
}

const info = existsSync(infoPlist) ? plist(infoPlist) : null;
if (info) {
  pass("version", info.CFBundleShortVersionString || "unknown");
  if (info.CFBundleIdentifier === "com.anthropic.claudefordesktop.3p") {
    pass("bundle id", info.CFBundleIdentifier);
  } else {
    fail("bundle id", `expected com.anthropic.claudefordesktop.3p, got ${info.CFBundleIdentifier}`);
  }
  if (info.CFBundleDisplayName === "Claude-3p") {
    pass("display name", info.CFBundleDisplayName);
  } else {
    warn("display name", `got ${info.CFBundleDisplayName || "<missing>"}`);
  }
  if (info.CFBundleName === "Claude") {
    pass("bundle name", "Claude (required for Electron helper lookup)");
  } else {
    warn("bundle name", `got ${info.CFBundleName || "<missing>"}`);
  }
}

const sourceInfoPath = path.join(sourceApp, "Contents", "Info.plist");
if (existsSync(sourceInfoPath)) {
  const sourceInfo = plist(sourceInfoPath);
  const builtVersion = info?.CFBundleShortVersionString;
  const sourceVersion = sourceInfo?.CFBundleShortVersionString;
  if (sourceVersion && builtVersion && sourceVersion === builtVersion) {
    pass("upstream source", `${sourceApp} (${sourceVersion})`);
  } else {
    warn(
      "upstream source",
      `${sourceApp} is ${sourceVersion || "<unknown>"}, built app is ${builtVersion || "<unknown>"}; rebuild from the current official app`,
    );
  }
} else {
  warn("upstream source", `official app not found: ${sourceApp}`);
}

if (existsSync(ionAsar)) {
  const bytes = readFileSync(ionAsar);
  const headerSize = bytes.readUInt32LE(12);
  const header = JSON.parse(bytes.subarray(16, 16 + headerSize).toString("utf8"));
  function has(entry) {
    let node = header;
    for (const part of entry.split("/")) {
      node = node?.files?.[part];
      if (!node) return false;
    }
    return !node.files;
  }
  if (has("i18n/zh-Hans.json") && has("i18n/dynamic/zh-Hans.json")) {
    pass("Chinese UI resources", "zh-Hans + dynamic installed");
  } else {
    fail("Chinese UI resources", "zh-Hans catalog is missing from ion-dist.asar");
  }
  if (existsSync(path.join(app, "Contents", "Resources", "zh-Hans.lproj", "Localizable.strings"))) {
    pass("Chinese desktop shell", "Localizable.strings present");
  } else {
    warn("Chinese desktop shell", "Localizable.strings missing");
  }
} else {
  warn("Chinese UI resources", "ion-dist.asar not found");
}

const running = run("pgrep", ["-f", `${app}/Contents/MacOS/Claude`]);
if (running) pass("process", `running (pid ${running.split(/\s+/)[0]})`);
else warn("process", "not running");

const signature = runCombined("codesign", ["-dvv", app]);
if (!signature) {
  fail("signature", "codesign could not read the app");
} else {
  const identifier = signature.match(/^Identifier=(.+)$/m)?.[1];
  const authority = signature.match(/^Authority=(.+)$/m)?.[1];
  if (identifier === "com.anthropic.claudefordesktop.3p") pass("signature id", identifier);
  else fail("signature id", identifier || "missing");
  if (authority === "Claude-3p Signing") pass("signature identity", authority);
  else if (signature.includes("Signature=adhoc")) warn("signature identity", "ad-hoc; TCC may reset after rebuild");
  else warn("signature identity", authority || "unknown");
  const verify = run("codesign", ["--verify", "--deep", "--strict", app]);
  if (verify !== null) pass("codesign verify", "valid");
  else fail("codesign verify", "failed");
}

if (info?.ElectronAsarIntegrity && existsSync(asarPath)) {
  const bytes = readFileSync(asarPath);
  const headerSize = bytes.readUInt32LE(12);
  const header = JSON.stringify(JSON.parse(bytes.subarray(16, 16 + headerSize).toString("utf8")));
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(header).digest("hex");
  if (info.ElectronAsarIntegrity["Resources/app.asar"]?.hash === hash) {
    pass("asar header", hash);
  } else {
    fail("asar header", "Info.plist hash does not match app.asar header");
  }
}

if (existsSync(framework)) {
  const fw = readFileSync(framework);
  const digest = (() => {
    const entries = info?.ElectronAsarIntegrity || {};
    const h = createHash("sha256");
    for (const key of Object.keys(entries).sort()) {
      h.update(key); h.update(entries[key].algorithm); h.update(entries[key].hash);
    }
    return h.digest("hex");
  })();
  if (fw.includes(Buffer.from(digest, "hex"))) pass("dictionary digest", digest);
  else fail("dictionary digest", "not found in Electron Framework");
} else {
  fail("dictionary digest", "Electron Framework not found");
}

const helperNames = [
  "Claude Helper.app",
  "Claude Helper (GPU).app",
  "Claude Helper (Plugin).app",
  "Claude Helper (Renderer).app",
];
for (const name of helperNames) {
  const hp = path.join(app, "Contents", "Frameworks", name, "Contents", "Info.plist");
  const h = existsSync(hp) ? plist(hp) : null;
  if (h?.CFBundleIdentifier?.startsWith("com.anthropic.claudefordesktop.3p.helper")) {
    pass(`helper ${name}`, h.CFBundleIdentifier);
  } else {
    fail(`helper ${name}`, h?.CFBundleIdentifier || "missing");
  }
}

function ent(file) {
  return run("codesign", ["-d", "--entitlements", ":-", file]) || "";
}
if (ent(app).includes("com.apple.security.virtualization")) pass("main virtualization", "present");
else fail("main virtualization", "missing");
if (ent(path.join(app, "Contents", "Frameworks", "Claude Helper.app")).includes("com.apple.security.virtualization")) {
  pass("helper virtualization", "present");
} else {
  fail("helper virtualization", "missing");
}
for (const p of [path.join(app, "Contents", "Frameworks", "Claude Helper (Renderer).app"), path.join(app, "Contents", "Helpers", "app-cu-helper")]) {
  if (ent(p).includes("com.apple.security.virtualization")) fail(`minimal entitlements ${path.basename(p)}`, "virtualization leaked");
  else pass(`minimal entitlements ${path.basename(p)}`, "no virtualization");
}
if (!existsSync(path.join(app, "Contents", "embedded.provisionprofile"))) pass("provisionprofile", "removed");
else fail("provisionprofile", "stale file still present");

if (existsSync(configPath)) {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const prefs = cfg.preferences || {};
    if (cfg.deploymentMode === "3p") pass("3P mode file", "3p");
    else warn("3P mode file", cfg.deploymentMode || "<missing>");
    if (prefs.chicagoEnabled === true) pass("chicagoEnabled", "true");
    else warn("chicagoEnabled", String(prefs.chicagoEnabled ?? "<missing>"));
    if (prefs.chicagoPreferredMode) pass("preferred mode", prefs.chicagoPreferredMode);
    else warn("preferred mode", "<missing>");
    const lib = path.join(path.dirname(configPath), "configLibrary");
    const metaPath = path.join(lib, "_meta.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const applied = meta.appliedId && path.join(lib, `${meta.appliedId}.json`);
      if (applied && existsSync(applied)) {
        const c = JSON.parse(readFileSync(applied, "utf8"));
        pass("inference provider", c.inferenceProvider || "<unset>");
        if (c.disableAutoUpdates === true) {
          pass("auto-updates", "disabled (disableAutoUpdates=true)");
        } else {
          warn(
            "auto-updates",
            `disableAutoUpdates=${String(c.disableAutoUpdates ?? "<missing>")}; a new or updated config can replace the patched app`,
          );
        }
      } else {
        warn("auto-updates", "applied 3P config not found; cannot verify disableAutoUpdates");
      }
    } else {
      warn("auto-updates", "configLibrary/_meta.json not found; cannot verify disableAutoUpdates");
    }
  } catch (e) {
    fail("3P config", e.message);
  }
} else {
  warn("3P config", `not found: ${configPath}`);
}

const main = tail(mainLog);
const chicago = lastMatch(main, /\[chicago\][^\n]*enabled=(true|false)[^\n]*appScoped=(true|false)/g);
if (chicago) {
  const enabled = chicago[1];
  const appScoped = chicago[2];
  if (enabled === "true") pass("Computer Use rollout gate", `rollout=true appScoped=${appScoped}`);
  else fail("Computer Use rollout gate", `rollout=${enabled} appScoped=${appScoped}`);
} else {
  warn("Computer Use rollout gate", "no [chicago] line in recent main.log");
}
const threeP = lastMatch(main, /3P mode active \{ provider: '([^']+)' \}/g);
if (threeP) pass("3P runtime", `provider=${threeP[1]}`);
else warn("3P runtime", "no 3P mode active line");
if (/Virtualization not available|installation appears to be invalid/i.test(main)) {
  warn("workspace error", "old entitlement/install error found in log history");
} else {
  pass("workspace error", "none in recent log history");
}

const vmAll = tail(vmLog);
const vmStart = Math.max(
  vmAll.lastIndexOf("[VM] Loading @ant/claude-swift module"),
  vmAll.lastIndexOf("[VM:start] Beginning startup"),
);
const vm = vmStart >= 0 ? vmAll.slice(vmStart) : vmAll.slice(-20_000);
if (/Startup complete|guest_ready completed/i.test(vm)) pass("workspace VM", "started / guest ready");
else warn("workspace VM", "no recent startup-complete line");
if (/Virtualization not available|entitlement_missing/i.test(vm)) fail("workspace VM entitlement", "entitlement missing");

const swift = tail(swiftLog);
const bundleId = info?.CFBundleIdentifier || "com.anthropic.claudefordesktop.3p";
const a11yTcc = tccAuth("kTCCServiceAccessibility", bundleId);
if (a11yTcc.state === "granted") {
  pass("accessibility", "granted (TCC)");
} else if (a11yTcc.state === "denied") {
  warn("accessibility", "denied (TCC); grant it in System Settings");
} else {
  const a11y = lastMatch(
    swift,
    /\[Hotkey\][^\n]*Accessibility permissions detected|\[Hotkey\][^\n]*No accessibility permissions/g,
  );
  if (a11y) {
    warn(
      "accessibility",
      `unknown (${a11yTcc.detail}); app log ${a11y[0].includes("detected") ? "says granted" : "says not granted"}`,
    );
  } else {
    warn("accessibility", `unknown (${a11yTcc.detail}); no status in app log`);
  }
}

const screenTcc = tccAuth("kTCCServiceScreenCapture", bundleId);
if (screenTcc.state === "granted") {
  pass("screen recording", "granted (TCC)");
} else if (screenTcc.state === "denied") {
  warn("screen recording", "denied (TCC); grant it in System Settings");
} else if (/screen recording|ScreenCapture|screen recording permissions/i.test(main)) {
  warn("screen recording", `unknown (${screenTcc.detail}); app log mentions screen recording`);
} else {
  warn("screen recording", `unknown (${screenTcc.detail}); no status in app log`);
}

const fails = checks.filter((c) => c.status === "FAIL").length;
const warns = checks.filter((c) => c.status === "WARN").length;
const result = { app, profile: args.profile, checks, summary: { pass: checks.length - fails - warns, warn: warns, fail: fails } };
if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Claude-3p Doctor — ${app}`);
  for (const c of checks) console.log(`${c.status.padEnd(4)} ${c.name}: ${c.detail}`);
  console.log(`\n${result.summary.pass} passed, ${warns} warnings, ${fails} failures`);
}
process.exit(fails > 0 ? 1 : 0);
