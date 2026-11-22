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

function asarEntry(archive, wanted) {
  const bytes = readFileSync(archive);
  const headerSize = bytes.readUInt32LE(12);
  const header = JSON.parse(bytes.subarray(16, 16 + headerSize).toString("utf8"));
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

const mainChunk = asarEntry(asarPath, ".vite/build/index.chunk-CEv0BLqc.js");
if (!mainChunk) {
  throw new Error("app.asar is missing the Computer Use main chunk");
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
for (const policySnippet of [
  'WP(e)&&Fy("chicagoEnabled")',
  '!Fy("chicagoEnabled")&&Fy("chicagoOffOverDefault")!==!0',
]) {
  if (!mainJs.includes(policySnippet)) {
      throw new Error(`Computer Use policy check is missing: ${policySnippet}`);
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
const shared = asarEntry(ionAsarPath, "assets/v1/shared-153-BdmJCTc6.js");
if (!shared || !shared.toString("utf8").includes('"zh-Hans"')) {
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
