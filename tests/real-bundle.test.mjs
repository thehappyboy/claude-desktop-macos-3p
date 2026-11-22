import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const app = path.resolve(process.env.CLAUDE_3P_APP || "/Applications/Claude-3p.app");
const asarPath = path.join(app, "Contents", "Resources", "app.asar");
const asarCache = new Map();

function asarHeader(archive) {
  if (asarCache.has(archive)) return asarCache.get(archive);
  const bytes = readFileSync(archive);
  const size = bytes.readUInt32LE(12);
  const data = {
    bytes,
    size,
    header: JSON.parse(bytes.subarray(16, 16 + size).toString("utf8")),
  };
  asarCache.set(archive, data);
  return data;
}

function asarFiles(archive) {
  const { header } = asarHeader(archive);
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

function asarEntry(archive, wanted) {
  const { bytes, size: headerSize, header } = asarHeader(archive);
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

function findMainChunk() {
  for (const name of asarFiles(asarPath).filter((entry) => /^\.vite\/build\/index.*\.js$/.test(entry))) {
    const content = asarEntry(asarPath, name);
    if (content?.toString("utf8").includes("__macCu3P_rollout")) {
      return content.toString("utf8");
    }
  }
  return null;
}

function functionSource(source, names) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) continue;
    let parens = 0;
    let body = -1;
    for (let i = source.indexOf("(", start); i < source.length; i += 1) {
      if (source[i] === "(") parens += 1;
      else if (source[i] === ")") {
        parens -= 1;
        if (parens === 0 && source[i + 1] === "{") {
          body = i + 1;
          break;
        }
      }
    }
    if (body < 0) continue;
    let depth = 0;
    for (let i = body; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}" && --depth === 0) {
        return { name, source: source.slice(start, i + 1) };
      }
    }
  }
  return null;
}

function bind(source, names, settings = {}) {
  const stubs = {
    uIr: () => settings.uIr ?? true,
    eBr: () => settings.eBr ?? false,
    qzr: () => settings.qzr ?? false,
    wzr: () => settings.wzr ?? true,
    UP: () => true,
    Eb: () => true,
    Xzr: () => false,
    Yzr: () => [],
    Zzr: () => true,
    mP: () => settings.uIr ?? true,
    fGr: () => settings.eBr ?? false,
    aGr: () => settings.qzr ?? false,
    bP: () => true,
    Dv: () => true,
    FWr: () => settings.wzr ?? true,
    cGr: () => false,
    sGr: () => [],
    lGr: () => true,
    U: () => ({ type: "3p" }),
    h2e: () => false,
    qR: () => false,
    nBr: () => false,
    tBr: () => false,
    qXt: () => false,
    sz: () => false,
    pGr: () => false,
    mGr: () => false,
  };
  const namesList = [...names];
  return new Function(...namesList, `return (${source});`)(...namesList.map((name) => stubs[name]));
}

test(
  "installed bundle keeps allowed/denied-apps policy fail-closed",
  { skip: !existsSync(asarPath) && `installed app not found: ${asarPath}` },
  () => {
    const source = findMainChunk();
    assert.ok(source, "patched Computer Use main chunk not found");

    const wp = functionSource(source, ["xP", "WP"]);
    assert.ok(wp, "rollout gate not found");
    const callWp = (settings) => bind(wp.source, Object.keys({
      uIr: 1, eBr: 1, qzr: 1, wzr: 1, UP: 1, Eb: 1, Xzr: 1, Yzr: 1, Zzr: 1,
      mP: 1, fGr: 1, aGr: 1, bP: 1, Dv: 1, FWr: 1, cGr: 1, sGr: 1, lGr: 1, U: 1,
    }), settings);

    assert.equal(callWp({})(), true);
    assert.equal(callWp({ wzr: false })(), false);
    assert.equal(callWp({ eBr: true })(), false);
    assert.equal(callWp({ uIr: false })(), false);

    const status = functionSource(source, ["uxi", "Tsi"]);
    assert.ok(status, "status mapper not found");
    const callStatus = (settings) => bind(status.source, Object.keys({
      uIr: 1, eBr: 1, wzr: 1, U: 1, h2e: 1, qR: 1, Eb: 1, nBr: 1, tBr: 1,
      mP: 1, fGr: 1, FWr: 1, qXt: 1, sz: 1, Dv: 1, pGr: 1, mGr: 1,
    }), settings)("computerUseRollout");

    assert.equal(callStatus({}).status, "supported");
    assert.notEqual(callStatus({ wzr: false }).status, "supported");
    assert.notEqual(callStatus({ eBr: true }).status, "supported");
    assert.notEqual(callStatus({ uIr: false }).status, "supported");
  },
);
