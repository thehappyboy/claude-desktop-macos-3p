import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { integrityDictionaryDigest } from "./patch-app.mjs";

const app = path.resolve(process.argv[2] || "");
const asarPath = path.join(app, "Contents", "Resources", "app.asar");
const ionAsarPath = path.join(app, "Contents", "Resources", "ion-dist.asar");
const plistPath = path.join(app, "Contents", "Info.plist");
const framework = path.join(
  app,
  "Contents",
  "Frameworks",
  "Electron Framework.framework",
  "Versions",
  "A",
  "Electron Framework",
);
const asarCache = new Map();

function asarData(archive) {
  if (asarCache.has(archive)) return asarCache.get(archive);
  const bytes = readFileSync(archive);
  const headerSize = bytes.readUInt32LE(12);
  const header = JSON.parse(bytes.subarray(16, 16 + headerSize).toString("utf8"));
  const data = { bytes, headerSize, header };
  asarCache.set(archive, data);
  return data;
}

function asarEntry(archive, wanted) {
  const { bytes, headerSize, header } = asarData(archive);
  let node = header;
  for (const part of wanted.split("/")) {
    node = node?.files?.[part];
    if (!node) return null;
  }
  if (node.files || node.unpacked) return null;
  const padding = (4 - (headerSize % 4)) % 4;
  const start = 16 + headerSize + padding + Number(node.offset || 0);
  return bytes.subarray(start, start + Number(node.size || 0));
}

function asarFileNames(archive) {
  const { header } = asarData(archive);
  const names = [];
  function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, full);
      else names.push(full);
    }
  }
  walk(header, "");
  return names;
}

const bytes = readFileSync(asarPath);
const headerSize = bytes.readUInt32LE(12);
const header = JSON.stringify(
  JSON.parse(bytes.subarray(16, 16 + headerSize).toString("utf8")),
);
const headerHash = createHash("sha256").update(header).digest("hex");
const plist = JSON.parse(execFileSync("/usr/bin/plutil", [
  "-convert",
  "json",
  "-o",
  "-",
  plistPath,
], { encoding: "utf8" }));
const integrity = plist.ElectronAsarIntegrity;
if (plist.CFBundleIdentifier === "com.anthropic.claudefordesktop") {
  throw new Error("bundle id still collides with the official app");
}
if (plist.CFBundleDisplayName !== "Claude-3p") {
  throw new Error(`unexpected display name: ${plist.CFBundleDisplayName}`);
}
if (plist.CFBundleName !== "Claude") {
  throw new Error(`unexpected bundle name: ${plist.CFBundleName}`);
}
if (plist.CFBundleIdentifier !== "com.anthropic.claudefordesktop.3p") {
  throw new Error(`unexpected bundle id: ${plist.CFBundleIdentifier}`);
}
if (
  plist.ElectronAsarIntegrity?.["Resources/app.asar"] === undefined ||
  plist.ElectronAsarIntegrity?.["Resources/ion-dist.asar"] === undefined
) {
  throw new Error("ElectronAsarIntegrity is missing an asar entry");
}
if (existsSync(path.join(app, "Contents", "embedded.provisionprofile"))) {
  throw new Error("stale embedded.provisionprofile is still present");
}

const mainCandidates = asarFileNames(asarPath).filter((name) =>
  /^\.vite\/build\/index.*\.js$/.test(name),
);
let mainChunk = null;
for (const name of mainCandidates) {
  const content = asarEntry(asarPath, name);
  if (content?.toString("utf8").includes(`__macCu3P_rollout`)) {
    mainChunk = content;
    break;
  }
}
if (!mainChunk) {
  throw new Error("app.asar is missing the patched Computer Use main chunk");
}
const mainJs = mainChunk.toString("utf8");
for (const marker of ["rollout", "status", "appscoped"]) {
  if (!mainJs.includes(`__macCu3P_${marker}`)) {
      throw new Error(`missing Computer Use patch marker: ${marker}`);
  }
}
for (const stale of ["enabled", "optedout"]) {
  if (mainJs.includes(`__macCu3P_${stale}`)) {
      throw new Error(`stale policy-bypassing Computer Use patch marker: ${stale}`);
  }
}
for (const [label, pattern] of [
  ["enabled preference", /[\w$]+\(e\)&&[\w$]+\("chicagoEnabled"\)/],
  ["opt-out state", /![\w$]+\("chicagoEnabled"\)&&[\w$]+\("chicagoOffOverDefault"\)!==!0/],
  ["denied-apps guard", /if\(![\w$]+\(\)\)return!1;/],
  ["status policy gate", /if\(![\w$]+\(\)&&[\w$]+\(\)\)return\{status:"supported"\}/],
  [
    "status fail closed",
    /return\{status:"unsupported",reason:"Computer use is off because its allowed-apps or denied-apps settings could not be read\./,
  ],
]) {
  if (!pattern.test(mainJs)) {
    throw new Error(`Computer Use policy check is missing: ${label}`);
  }
}

for (const entry of ["i18n/zh-Hans.json", "i18n/dynamic/zh-Hans.json"]) {
  if (!asarEntry(ionAsarPath, entry)) {
    throw new Error(`ion-dist.asar is missing ${entry}`);
  }
}
const zh = JSON.parse(asarEntry(ionAsarPath, "i18n/zh-Hans.json").toString("utf8"));
if (Object.keys(zh).length < 1000) {
  throw new Error(`ion-dist zh-Hans catalog is unexpectedly small (${Object.keys(zh).length})`);
}
const dynamicZh = JSON.parse(
  asarEntry(ionAsarPath, "i18n/dynamic/zh-Hans.json").toString("utf8"),
);
if (Object.keys(dynamicZh).length < 1) {
  throw new Error("ion-dist dynamic zh-Hans catalog is empty");
}
const hasZhHansWhitelist = asarFileNames(ionAsarPath)
  .filter((name) => /^assets\/v1\/.*\.js$/.test(name))
  .some((name) => asarEntry(ionAsarPath, name)?.toString("utf8").includes('"zh-Hans"'));
if (!hasZhHansWhitelist) {
  throw new Error("ion-dist language whitelist does not include zh-Hans");
}
if (!existsSync(path.join(app, "Contents", "Resources", "zh-Hans.lproj", "Localizable.strings"))) {
  throw new Error("desktop zh-Hans Localizable.strings is missing");
}
if (!String(zh["f2RDZ/Il9s"] || "").startsWith("背景：")) {
  throw new Error("zh-Hans Computer Use description override is missing");
}

for (const name of [
  "Claude Helper.app",
  "Claude Helper (GPU).app",
  "Claude Helper (Plugin).app",
  "Claude Helper (Renderer).app",
]) {
  const helperPlist = JSON.parse(execFileSync("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    path.join(app, "Contents", "Frameworks", name, "Contents", "Info.plist"),
  ], { encoding: "utf8" }));
  if (!helperPlist.CFBundleIdentifier.startsWith(`${plist.CFBundleIdentifier}.helper`)) {
    throw new Error(`${name}: helper bundle id was not isolated`);
  }
}

function entitlements(target) {
  return execFileSync(
    "codesign",
    ["-d", "--entitlements", ":-", target],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

if (!entitlements(app).includes("com.apple.security.virtualization")) {
  throw new Error("main app lost the virtualization entitlement");
}
if (
  !entitlements(
    path.join(app, "Contents", "Frameworks", "Claude Helper.app"),
  ).includes("com.apple.security.virtualization")
) {
  throw new Error("Claude Helper.app lost the virtualization entitlement");
}
for (const target of [
  path.join(app, "Contents", "Frameworks", "Claude Helper (Renderer).app"),
  path.join(app, "Contents", "Helpers", "app-cu-helper"),
]) {
  if (entitlements(target).includes("com.apple.security.virtualization")) {
    throw new Error(`${target}: over-broad virtualization entitlement`);
  }
}

if (integrity["Resources/app.asar"].hash !== headerHash) {
  throw new Error("app.asar header hash does not match Info.plist");
}

const digest = integrityDictionaryDigest(integrity);
const fw = readFileSync(framework);
if (!fw.includes(Buffer.from(digest, "hex"))) {
  throw new Error("integrity dictionary digest is not patched into Electron Framework");
}

const entitlementsXml = execFileSync(
  "codesign",
  ["-d", "--entitlements", ":-", app],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
if (!entitlementsXml.includes("com.apple.security.virtualization")) {
  throw new Error("com.apple.security.virtualization entitlement is missing");
}

console.log(`asar header: ${headerHash}`);
console.log(`dictionary: ${digest}`);
console.log("virtualization entitlement: present");
console.log(`bundle: ${plist.CFBundleIdentifier} / ${plist.CFBundleDisplayName}`);
console.log("Computer Use policy checks: preserved");
console.log(`i18n: zh-Hans (${Object.keys(zh).length} frontend entries, ${Object.keys(dynamicZh).length} dynamic entries)`);
