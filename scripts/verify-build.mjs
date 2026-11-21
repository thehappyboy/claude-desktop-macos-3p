import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { integrityDictionaryDigest } from "./patch-app.mjs";

const app = path.resolve(process.argv[2] || "");
const asarPath = path.join(app, "Contents", "Resources", "app.asar");
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
