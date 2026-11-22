#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "__macCu3P";
const DEFAULT_APP = "/Applications/Claude.app";
const DEFAULT_OUT = path.join(ROOT, "dist", "Claude-3p.app");

function parseArgs(argv) {
  const out = {
    app: DEFAULT_APP,
    out: DEFAULT_OUT,
    sign: true,
    dryRun: false,
    bundleId: "com.anthropic.claudefordesktop.3p",
    displayName: "Claude-3p",
    productName: "Claude",
    identity: "auto",
    i18n: true,
    lang: "zh-Hans",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") out.app = path.resolve(argv[++i]);
    else if (arg === "--out") out.out = path.resolve(argv[++i]);
    else if (arg === "--bundle-id") out.bundleId = argv[++i];
    else if (arg === "--display-name") out.displayName = argv[++i];
    else if (arg === "--product-name") out.productName = argv[++i];
    else if (arg === "--identity") out.identity = argv[++i];
    else if (arg === "--no-i18n") out.i18n = false;
    else if (arg === "--lang") out.lang = argv[++i];
    else if (arg === "--no-sign") out.sign = false;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "-h" || arg === "--help") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage: node scripts/patch-app.mjs [options]",
    "",
    "  --app <Claude.app>   Source app (default /Applications/Claude.app)",
    "  --out <Claude.app>   Output app (default dist/Claude-3p.app)",
    "  --bundle-id <id>     Output bundle id (default com.anthropic.claudefordesktop.3p)",
    "  --display-name <s>   Output display name (default Claude-3p)",
    "  --product-name <s>   Electron product name (default Claude; keeps the existing keychain item)",
    "  --identity <name>    Signing identity (default auto; '-' means ad-hoc)",
    "  --lang <code>        UI language resources (default zh-Hans)",
    "  --no-i18n            Do not install Chinese UI resources",
    "  --dry-run            Inspect and report only; write nothing",
    "  --no-sign            Do not re-sign the output app",
    "  -h, --help           Show this help",
  ].join("\n");
}

function readPlistValue(plistPath, key) {
  return execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Print :${key}`,
    plistPath,
  ], { encoding: "utf8" }).trim();
}

function asarHeaderHash(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 16) throw new Error(`Short asar: ${file}`);
  const headerSize = bytes.readUInt32LE(12);
  const header = bytes.subarray(16, 16 + headerSize).toString("utf8");
  const canonical = JSON.stringify(JSON.parse(header));
  return createHash("sha256").update(canonical).digest("hex");
}

export function integrityDictionaryDigest(integrity) {
  const hash = createHash("sha256");
  for (const key of Object.keys(integrity).sort()) {
    const entry = integrity[key];
    hash.update(key);
    hash.update(entry.algorithm);
    hash.update(entry.hash);
  }
  return hash.digest("hex");
}

function electronFrameworkBinary(appPath) {
  const candidates = [
    path.join(
      appPath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Electron Framework",
    ),
    path.join(
      appPath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "Current",
      "Electron Framework",
    ),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Electron Framework binary not found");
  return found;
}

function patchIntegrityDictionaryDigest(appPath, originalIntegrity, integrity) {
  const oldDigest = Buffer.from(integrityDictionaryDigest(originalIntegrity), "hex");
  const wanted = Buffer.from(integrityDictionaryDigest(integrity), "hex");
  const binary = path.join(appPath, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Electron Framework");
  const file = existsSync(binary) ? binary : electronFrameworkBinary(appPath);
  const bytes = readFileSync(file);
  const slots = new Set();
  for (const digest of [oldDigest, wanted]) {
    let at = 0;
    while ((at = bytes.indexOf(digest, at)) !== -1) {
      const slot = at - 34;
      if (slot >= 0 && bytes[slot + 32] === 1 && bytes[slot + 33] === 1) {
        const sentinel = bytes.subarray(slot, slot + 32);
        if (sentinel.every((byte) => byte >= 0x20 && byte <= 0x7e)) {
          slots.add(slot);
          wanted.copy(bytes, at);
        }
      }
      at += 1;
    }
  }
  if (slots.size === 0) {
    throw new Error(
      "Electron integrity dictionary slot not found; this Electron build may predate the dictionary digest.",
    );
  }
  writeFileSync(file, bytes);
  return { file, slots: [...slots], digest: wanted.toString("hex") };
}

function findBundleJs(root) {
  const buildDir = path.join(root, ".vite", "build");
  if (!existsSync(buildDir)) {
    throw new Error(`Missing .vite/build in extracted app.asar: ${buildDir}`);
  }
  return readdirSync(buildDir)
    .filter((name) => /^index.*\.js$/.test(name))
    .map((name) => path.join(buildDir, name));
}

function patchOnce(source, id, pattern, replacement) {
  const already = source.includes(`${MARKER}_${id}`);
  if (already) return { source, applied: false };
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(
      `${id}: expected exactly one anchor, found ${matches.length}. ` +
        "Claude Desktop was likely updated; re-audit the minified bundle.",
    );
  }
  return {
    source: source.replace(pattern, replacement),
    applied: true,
  };
}

/**
 * Pure source transform. Kept exported for tests.
 *
 * The macOS native Computer Use executor is present upstream. In 3P mode the
 * feature is hidden by the GrowthBook rollout gate. We force only that gate in
 * 3P on macOS; the user's chicagoEnabled switch, managed settings and allowed-
 * apps readability checks stay in front of it.
 *
 *   WP  - account/rollout/device-management gate used by computerUseRollout.
 *   GP  - isComputerUseEnabled, additionally requires the chicagoEnabled pref.
 *   iBr - "available but opted out", derived from WP and chicagoEnabled.
 *   Tsi - maps those gates to the feature status the 3P SPA reads.
 */
export function patchSource(source) {
  for (const stale of ["enabled", "optedout"]) {
    if (source.includes(`${MARKER}_${stale}`)) {
      throw new Error(
        `Stale ${stale} patch found; rebuild from the official Claude.app instead of patching an older output.`,
      );
    }
  }

  let next = source;
  const applied = [];

  // isComputerUseRolledOut: force the GrowthBook rollout part in 3P on macOS.
  // uIr() (managed computerUseEnabled), eBr() (allowed-apps readability) and
  // wzr() (denied-apps readability) still run first, so policy denials keep
  // Computer Use off.
  {
    const id = "rollout";
    const pattern =
      /(function [\w$]+\([\w$]+=\{\}\)\{if\(![\w$]+\(\)\|\|[\w$]+\(\)\)return\s*!1;)(if\([\w$]+\(\)\)return\s*!0;)/;
    const result = patchOnce(next, id, pattern, (whole, head, gate) => {
      return (
        `${head}/*${MARKER}_${id}*/${gate}` +
        `if(process.platform==="darwin"&&K().type==="3p"){if(!wzr())return!1;return!0;}`
      );
    });
    next = result.source;
    if (result.applied) applied.push(id);
  }

  // Tsi: feature-status mapper for computerUseRollout / computerUseLocal.
  // Keep its managed-settings failure branch; only replace the GrowthBook
  // rollout answer after that branch has run.
  {
    const id = "status";
    const pattern =
      /(function [\w$]+\([\w$]+\)\{)(if\(![\w$]+\(\)\)return [\w$]+\(\)\?\{status:["'`]unsupported["'`][\s\S]*?;)(?=let )/;
    const result = patchOnce(next, id, pattern, (whole, head, managedCheck) =>
      `${head}/*${MARKER}_${id}*/${managedCheck}` +
      `if(process.platform==="darwin"&&K().type==="3p"){` +
      `if(!eBr()&&wzr())return{status:"supported"};` +
      `return{status:"unsupported",reason:"Computer use is off because its allowed-apps or denied-apps settings could not be read. Restart the app to read them again.",unsupportedCode:"unknown"};}`,
    );
    next = result.source;
    if (result.applied) applied.push(id);
  }

  // Background app-scoped mode: 3P has no GrowthBook config, so KP() is false.
  // Enable it on macOS 15+ in 3P so both the executor and the settings UI agree.
  {
    const id = "appscoped";
    const pattern =
      /function ([\w$]+)\(([\w$]+)=\{\}\)\{let ([\w$]+)=\2\.requireFreshGrowthBook\?\?!0;if\(process\.platform!=="darwin"\)return!1;let ([\w$]+)=[\w$]+\(\);return \4\.major<15\|\|[\w$]+\(\4,[\w$]+\(\)\)\|\|\3&&![\w$]+\(\)\?!1:[\w$]+\([\w$]+,"appScopedEnabled",!1,[\w$]+\(\)\)\}/;
    const result = patchOnce(next, id, pattern, (whole, fn, arg) =>
      `function ${fn}(${arg}={}){/*${MARKER}_${id}*/` +
      `if(process.platform==="darwin"&&K().type==="3p"){let n=Uk();if(n.major>=15&&!Vzr(n,Bzr()))return!0}` +
      whole.replace(/^function [\w$]+\([\w$]+=\{\}\)\{/, ""),
    );
    next = result.source;
    if (result.applied) applied.push(id);
  }

  return { source: next, applied };
}

function runAsar(args, cwd) {
  execFileSync("npx", ["--yes", "@electron/asar@4.3.2", ...args], {
    cwd,
    stdio: "inherit",
  });
}

function setAsarHash(plistPath, key, hash) {
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :ElectronAsarIntegrity:${key}:hash ${hash}`,
    plistPath,
  ], { stdio: "inherit" });
}

function installI18n(appPath, lang) {
  execFileSync("python3", [
    path.join(ROOT, "scripts", "patch-i18n.py"),
    appPath,
    lang,
  ], { stdio: "inherit" });
}

function filteredEntitlements(sourceApp, workDir, label, requireVirtualization = false) {
  const original = path.join(workDir, `${label}.original.plist`);
  const entitlements = path.join(workDir, `${label}.plist`);
  const entitlementsJson = path.join(workDir, `${label}.json`);
  const xml = execFileSync(
    "codesign",
    ["-d", "--entitlements", ":-", sourceApp],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (!xml.trim()) return null;
  writeFileSync(original, xml);
  const data = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", original], {
      encoding: "utf8",
    }),
  );
  delete data["com.apple.application-identifier"];
  delete data["com.apple.developer.team-identifier"];
  delete data["keychain-access-groups"];
  if (requireVirtualization) data["com.apple.security.virtualization"] = true;
  if (Object.keys(data).length === 0) return null;
  writeFileSync(entitlementsJson, `${JSON.stringify(data)}\n`);
  execFileSync("/usr/bin/plutil", [
    "-convert",
    "xml1",
    "-o",
    entitlements,
    entitlementsJson,
  ]);
  return { entitlements };
}

function detectSigningIdentity(requested) {
  if (requested === "-") return "-";
  if (requested !== "auto") return requested;
  const keychain = path.join(
    process.env.HOME || "",
    "Library",
    "Keychains",
    "Claude-3p-Signing.keychain-db",
  );
  const passFile = path.join(
    process.env.HOME || "",
    "Library",
    "Application Support",
    "Claude-3p-Signing",
    "signing-password",
  );
  if (existsSync(keychain) && existsSync(passFile)) {
    try {
      const password = readFileSync(passFile, "utf8").trim();
      execFileSync("security", ["unlock-keychain", "-p", password, keychain], {
        stdio: "ignore",
      });
    } catch {
      console.warn("[sign] could not unlock the local signing keychain");
    }
  }
  const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  return out.includes("Claude-3p Signing")
    ? "Claude-3p Signing"
    : "-";
}

function signPath(target, sourceForEntitlements, identity, workDir, label, opts = {}) {
  const args = ["--force"];
  if (opts.deep) args.push("--deep");
  args.push("--sign", identity, "--timestamp=none");
  const ent = sourceForEntitlements
    ? filteredEntitlements(
        sourceForEntitlements,
        workDir,
        label,
        opts.requireVirtualization === true,
      )
    : null;
  if (ent) args.push("--entitlements", ent.entitlements);
  if (opts.identifier) args.push("--identifier", opts.identifier);
  args.push(target);
  execFileSync("codesign", args, { stdio: "inherit" });
}

function helperId(bundleId, name) {
  const suffix = name.replace(/^Claude Helper(?: \((.+)\))?\.app$/, "$1");
  if (suffix && suffix !== name) return `${bundleId}.helper.${suffix}`;
  return `${bundleId}.helper`;
}

function signApp(appPath, sourceApp, bundleId, requestedIdentity) {
  const identity = detectSigningIdentity(requestedIdentity);
  const workDir = mkdtempSync(path.join(tmpdir(), "mac-cu-sign-"));
  try {
    const frameworks = path.join(appPath, "Contents", "Frameworks");
    for (const name of readdirSync(frameworks)) {
      const target = path.join(frameworks, name);
      if (name.endsWith(".framework")) {
        signPath(target, null, identity, workDir, `fw-${name}`);
      }
    }

    for (const name of readdirSync(frameworks)) {
      if (!name.startsWith("Claude Helper") || !name.endsWith(".app")) continue;
      const target = path.join(frameworks, name);
      const source = path.join(sourceApp, "Contents", "Frameworks", name);
      const plist = path.join(target, "Contents", "Info.plist");
      execFileSync("/usr/libexec/PlistBuddy", [
        "-c",
        `Set :CFBundleIdentifier ${helperId(bundleId, name)}`,
        plist,
      ], { stdio: "inherit" });
      signPath(target, source, identity, workDir, `helper-${name}`, {
        deep: true,
        requireVirtualization: name === "Claude Helper.app",
      });
    }

    const helpers = path.join(appPath, "Contents", "Helpers");
    for (const entry of readdirSync(helpers, { withFileTypes: true })) {
      if (entry.name === "Claude iOS Sim.app") continue;
      const target = path.join(helpers, entry.name);
      const source = path.join(sourceApp, "Contents", "Helpers", entry.name);
      if (entry.isDirectory()) {
        signPath(target, source, identity, workDir, `helper-app-${entry.name}`, {
          deep: true,
        });
      } else {
        signPath(target, source, identity, workDir, `tool-${entry.name}`, {
          identifier: `${bundleId}.helper.${entry.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`,
        });
      }
    }

    const iosSim = path.join(helpers, "Claude iOS Sim.app");
    if (existsSync(iosSim)) {
      signPath(
        iosSim,
        path.join(sourceApp, "Contents", "Helpers", "Claude iOS Sim.app"),
        identity,
        workDir,
        "ios-sim",
        { deep: true },
      );
    }

    // Sign the outer app last, without --deep, so its resource envelope seals
    // the already-signed nested code.
    signPath(appPath, sourceApp, identity, workDir, "main", {
      requireVirtualization: true,
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
  return identity;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const app = path.resolve(args.app);
  const out = path.resolve(args.out);
  const infoPlist = path.join(app, "Contents", "Info.plist");
  const appAsar = path.join(app, "Contents", "Resources", "app.asar");

  if (!existsSync(infoPlist) || !existsSync(appAsar)) {
    throw new Error(`Not a Claude.app bundle: ${app}`);
  }
  const version = readPlistValue(infoPlist, "CFBundleShortVersionString");
  const bundleId = readPlistValue(infoPlist, "CFBundleIdentifier");
  if (bundleId !== "com.anthropic.claudefordesktop") {
    throw new Error(`Refusing unexpected bundle id: ${bundleId}`);
  }

  console.log(`[source] ${app}`);
  console.log(`[version] ${version}`);
  console.log(`[output] ${out}`);
  console.log(`[identity] ${args.bundleId} / ${args.displayName}`);

  if (args.dryRun) {
    console.log("[dry-run] no files written");
    return;
  }

  if (out !== app) {
    mkdirSync(path.dirname(out), { recursive: true });
    if (existsSync(out)) {
      throw new Error(`Output already exists: ${out} (remove it or pick --out)`);
    }
    cpSync(app, out, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  }

  const outPlist = path.join(out, "Contents", "Info.plist");
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleIdentifier ${args.bundleId}`,
    outPlist,
  ], { stdio: "inherit" });

  const provision = path.join(out, "Contents", "embedded.provisionprofile");
  if (existsSync(provision)) {
    rmSync(provision);
    console.log("[identity] removed stale embedded.provisionprofile");
  }
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleDisplayName ${args.displayName}`,
    outPlist,
  ], { stdio: "inherit" });

  const work = mkdtempSync(path.join(tmpdir(), "mac-cu-asar-"));
  const unpacked = path.join(work, "app");
  try {
    runAsar(["extract", path.join(out, "Contents", "Resources", "app.asar"), unpacked], ROOT);

    const jsFiles = findBundleJs(unpacked);
    const hits = [];
    for (const file of jsFiles) {
      const before = readFileSync(file, "utf8");
      if (!before.includes("chicagoEnabled") || !before.includes("computerUseRollout")) continue;
      const result = patchSource(before);
      if (result.applied.length > 0) {
        writeFileSync(file, result.source);
        hits.push({ file: path.relative(unpacked, file), patches: result.applied });
      }
    }

    if (hits.length === 0) {
      throw new Error(
        "No Computer Use gate was patched. The app may already be patched, or upstream changed.",
      );
    }
    const ids = new Set(hits.flatMap((hit) => hit.patches));
    for (const required of ["rollout", "status", "appscoped"]) {
      if (!ids.has(required)) {
        throw new Error(`Required patch did not apply: ${required}`);
      }
    }

    for (const hit of hits) {
      execFileSync(process.execPath, ["--check", path.join(unpacked, hit.file)], {
        stdio: "inherit",
      });
      console.log(`[patch] ${hit.file}: ${hit.patches.join(", ")}`);
    }

    const packagePath = path.join(unpacked, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.productName = args.productName;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    console.log(`[identity] Electron productName ${args.productName}`);

    const rebuilt = path.join(out, "Contents", "Resources", "app.asar");
    runAsar(["pack", unpacked, rebuilt], ROOT);
    const hash = asarHeaderHash(rebuilt);
    setAsarHash(outPlist, "Resources/app.asar", hash);
    console.log(`[integrity] app.asar header sha256 ${hash}`);

    if (args.i18n) {
      if (args.lang !== "zh-Hans") {
        throw new Error(`Only zh-Hans is supported for --lang, got ${args.lang}`);
      }
      installI18n(out, args.lang);
    }

    const integrity = JSON.parse(execFileSync("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      outPlist,
    ], { encoding: "utf8" })).ElectronAsarIntegrity;
    const sourceIntegrity = JSON.parse(execFileSync("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      infoPlist,
    ], { encoding: "utf8" })).ElectronAsarIntegrity;
    const digest = patchIntegrityDictionaryDigest(out, sourceIntegrity, integrity);
    console.log(
      `[integrity] dictionary digest ${digest.digest} in ${digest.slots.length} slice(s)`,
    );

    const outVersion = readPlistValue(outPlist, "CFBundleShortVersionString");
    if (outVersion !== version) {
      throw new Error(`Output version changed unexpectedly: ${outVersion}`);
    }

    const buildInfo = {
      source: app,
      output: out,
      version,
      bundleId: args.bundleId,
      displayName: args.displayName,
      productName: args.productName,
      i18n: args.i18n ? args.lang : null,
      builtAt: new Date().toISOString(),
      appAsarIntegrityHash: hash,
      integrityDictionaryDigest: digest.digest,
      patches: hits,
    };
    mkdirSync(path.join(ROOT, "dist"), { recursive: true });
    writeFileSync(
      path.join(ROOT, "dist", "build-info.json"),
      `${JSON.stringify(buildInfo, null, 2)}\n`,
    );

    if (args.sign) {
      const identity = signApp(out, app, args.bundleId, args.identity);
      console.log(`[sign] signed with ${identity} and verified`);
    } else {
      console.log("[sign] skipped (--no-sign)");
    }
    console.log(`[done] open "${out}" --args --3p`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
