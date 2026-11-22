import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const app = path.resolve(process.env.CLAUDE_3P_APP || "/Applications/Claude-3p.app");
const asarPath = path.join(app, "Contents", "Resources", "app.asar");
const chunkPath = ".vite/build/index.chunk-CEv0BLqc.js";

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

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
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
  if (body < 0) return null;
  let depth = 0;
  for (let i = body; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

test(
  "installed bundle keeps denied-apps fail-closed",
  { skip: !existsSync(asarPath) && `installed app not found: ${asarPath}` },
  () => {
    const chunk = asarEntry(asarPath, chunkPath);
    assert.ok(chunk, `missing ${chunkPath}`);
    const source = chunk.toString("utf8");
    const wp = functionSource(source, "WP");
    assert.ok(wp, "WP() not found in the installed bundle");

    const call = (settings) =>
      new Function(
        "uIr",
        "eBr",
        "qzr",
        "wzr",
        "UP",
        "Eb",
        "Xzr",
        "Yzr",
        "Zzr",
        "K",
        `return (${wp});`,
      )(
        () => settings.uIr ?? true,
        () => settings.eBr ?? false,
        () => settings.qzr ?? false,
        () => settings.wzr ?? true,
        () => true,
        () => true,
        () => false,
        () => [],
        () => true,
        () => ({ type: "3p" }),
      );

    assert.equal(call({})["name"], "WP");
    assert.equal(call({})(), true);
    assert.equal(call({ wzr: false })(), false);
    assert.equal(call({ eBr: true })(), false);
    assert.equal(call({ uIr: false })(), false);

    const tsi = functionSource(source, "Tsi");
    assert.ok(tsi, "Tsi() not found in the installed bundle");
    const status = (settings) =>
      new Function(
        "uIr",
        "eBr",
        "wzr",
        "K",
        "h2e",
        "qR",
        "Eb",
        "nBr",
        "tBr",
        `return (${tsi});`,
      )(
        () => settings.uIr ?? true,
        () => settings.eBr ?? false,
        () => settings.wzr ?? true,
        () => ({ type: "3p" }),
        () => false,
        () => false,
        () => false,
        () => false,
        () => false,
      )("computerUseRollout");

    assert.equal(status({}).status, "supported");
    assert.notEqual(status({ wzr: false }).status, "supported");
    assert.notEqual(status({ eBr: true }).status, "supported");
    assert.notEqual(status({ uIr: false }).status, "supported");
  },
);
