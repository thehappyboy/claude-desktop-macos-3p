#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPDATE_ORIGIN = "https://api.anthropic.com";

function parseArgs(argv) {
  const out = {
    app: "/Applications/Claude-3p.app",
    sourceApp: "/Applications/Claude.app",
    baseline: path.join(ROOT, ".upstream-version"),
    offline: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") out.app = argv[++i];
    else if (arg === "--source-app") out.sourceApp = argv[++i];
    else if (arg === "--baseline") out.baseline = argv[++i];
    else if (arg === "--offline") out.offline = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "-h" || arg === "--help") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage: claude-3p --check-upstream [options]",
    "",
    "  --app <Claude-3p.app>       Built app (default /Applications/Claude-3p.app)",
    "  --source-app <Claude.app>  Official source app (default /Applications/Claude.app)",
    "  --baseline <file>           Validated baseline (default .upstream-version)",
    "  --offline                   Skip the official macOS update feed",
    "  --json                      Machine-readable output",
    "  -h, --help                  Show this help",
    "",
    "Exit codes: 0 current/aligned, 1 action required or local version mismatch.",
  ].join("\n");
}

function readText(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim() || null;
}

function readAppVersion(app) {
  const plist = path.join(app, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  try {
    return execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", plist],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || null;
  } catch {
    return null;
  }
}

function macosVersion() {
  try {
    return execFileSync("/usr/bin/sw_vers", ["-productVersion"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export function buildMacUpdateUrl(version, options = {}) {
  const deviceId = options.deviceId || randomUUID();
  const osVersion = options.osVersion || macosVersion();
  const params = new URLSearchParams({
    device_id: deviceId,
    version,
    os_version: osVersion,
  });
  return `${UPDATE_ORIGIN}/api/desktop/darwin/${options.arch || "universal"}/squirrel/update?${params}`;
}

export function parseUpdatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Update feed returned a non-object payload");
  }
  const version = payload.currentRelease ?? payload.version;
  if (typeof version !== "string" || !parseVersion(version)) {
    throw new Error("Update feed did not name a valid current release");
  }
  return version;
}

export async function fetchLatestMacOSVersion(options = {}) {
  const url = buildMacUpdateUrl(options.version, options);
  if (!options.fetchImpl) {
    const output = execFileSync(
      "/usr/bin/curl",
      ["-sS", "-m", String(Math.ceil((options.timeoutMs || 15_000) / 1000)), "-w", "\n%{http_code}", url],
      {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const splitAt = output.lastIndexOf("\n");
    if (splitAt < 0) throw new Error("Update feed returned an unreadable response");
    const body = output.slice(0, splitAt);
    const status = Number(output.slice(splitAt + 1).trim());
    if (status === 204 || status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new Error(`Update feed returned HTTP ${status}`);
    }
    try {
      return parseUpdatePayload(JSON.parse(body));
    } catch (error) {
      throw new Error(
        `Update feed returned an unreadable payload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const fetchImpl = options.fetchImpl;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs || 15_000),
  });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Update feed returned HTTP ${response.status}`);
  }
  return parseUpdatePayload(await response.json());
}

export function parseVersion(value) {
  const match = /^(\d+(?:\.\d+)*)(?:[-+].*)?$/.exec(String(value || "").trim());
  if (!match) return null;
  return match[1].split(".").map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    return String(left || "").localeCompare(String(right || ""), "en", {
      numeric: true,
      sensitivity: "base",
    });
  }
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function assessUpstream({ source, built, baseline, latest, offline = false }) {
  const checks = [];
  let action = false;
  const add = (status, name, detail) => checks.push({ status, name, detail });

  if (!baseline) {
    add("FAIL", "baseline", "missing or empty .upstream-version");
    action = true;
  } else {
    add("PASS", "baseline", baseline);
  }

  if (!source) {
    add("FAIL", "official source", "Claude.app or its Info.plist was not found");
    action = true;
  } else {
    add("PASS", "official source", source);
  }

  if (!built) {
    add("WARN", "built app", "Claude-3p.app or its Info.plist was not found");
  } else {
    add("PASS", "built app", built);
  }

  if (source && baseline && source !== baseline) {
    add(
      "FAIL",
      "source baseline",
      `${source} is not the validated baseline ${baseline}; rebuild, test, then update .upstream-version`,
    );
    action = true;
  }

  if (source && built && source !== built) {
    add(
      "FAIL",
      "build baseline",
      `${built} was built from a different official version (${source})`,
    );
    action = true;
  }

  if (offline) {
    add("SKIP", "latest macOS release", "offline mode");
  } else if (!latest) {
    add("WARN", "latest macOS release", "update feed could not be read");
  } else {
    add("PASS", "latest macOS release", latest);
    if (source) {
      const comparison = compareVersions(latest, source);
      if (comparison > 0) {
        add(
          "FAIL",
          "new upstream version",
          `${latest} is available; replace the source app, rebuild and re-audit`,
        );
        action = true;
      } else if (comparison < 0) {
        add(
          "WARN",
          "update feed",
          `${latest} is older than the local official app ${source}; verify the release channel`,
        );
      }
    }
  }

  return { checks, action };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const source = readAppVersion(args.sourceApp);
  const built = readAppVersion(args.app);
  const baseline = readText(args.baseline);
  let latest = null;
  let feedError = null;
  if (!args.offline && source) {
    try {
      latest = await fetchLatestMacOSVersion({ version: source });
    } catch (error) {
      feedError = error instanceof Error ? error.message : String(error);
    }
  }

  const result = assessUpstream({
    source,
    built,
    baseline,
    latest,
    offline: args.offline,
  });
  if (feedError) {
    const feed = result.checks.find((item) => item.name === "latest macOS release");
    if (feed) feed.detail = feedError;
  }
  const output = {
    app: path.resolve(args.app),
    sourceApp: path.resolve(args.sourceApp),
    baselineFile: path.resolve(args.baseline),
    source,
    built,
    baseline,
    latest,
    checks: result.checks,
    actionRequired: result.action,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Claude-3p upstream check — ${output.app}`);
    for (const item of result.checks) {
      console.log(`${item.status.padEnd(4)} ${item.name}: ${item.detail}`);
    }
    console.log(
      result.action
        ? "\nACTION REQUIRED: rebuild and audit before changing .upstream-version."
        : "\nCurrent: official source, built app and validated baseline are aligned.",
    );
  }
  process.exit(result.action ? 1 : 0);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
