import assert from "node:assert/strict";
import test from "node:test";
import {
  assessUpstream,
  buildMacUpdateUrl,
  compareVersions,
  parseUpdatePayload,
  parseVersion,
} from "../scripts/upstream-check.mjs";

test("parses and compares Claude desktop versions numerically", () => {
  assert.deepEqual(parseVersion("6.28899.6"), [6, 28899, 6]);
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(compareVersions("6.28899.6", "6.28899.6"), 0);
  assert.equal(compareVersions("6.28899.10", "6.28899.6"), 1);
  assert.equal(compareVersions("6.6395.1", "6.28899.6"), -1);
});

test("builds the official macOS Squirrel feed URL", () => {
  const url = new URL(buildMacUpdateUrl("6.28899.6", {
    deviceId: "00000000-0000-4000-8000-000000000000",
    osVersion: "26.1",
    arch: "universal",
  }));
  assert.equal(url.origin, "https://api.anthropic.com");
  assert.equal(url.pathname, "/api/desktop/darwin/universal/squirrel/update");
  assert.equal(url.searchParams.get("version"), "6.28899.6");
  assert.equal(url.searchParams.get("os_version"), "26.1");
});

test("reads the current release from either feed shape", () => {
  assert.equal(parseUpdatePayload({ currentRelease: "6.28899.6" }), "6.28899.6");
  assert.equal(parseUpdatePayload({ version: "6.30000.1" }), "6.30000.1");
  assert.throws(() => parseUpdatePayload({}), /did not name/);
});

test("accepts an aligned source, build and baseline", () => {
  const result = assessUpstream({
    source: "6.28899.6",
    built: "6.28899.6",
    baseline: "6.28899.6",
    latest: "6.28899.6",
  });
  assert.equal(result.action, false);
  assert.equal(result.checks.filter((item) => item.status === "FAIL").length, 0);
});

test("requires action when a new official version exists", () => {
  const result = assessUpstream({
    source: "6.28899.6",
    built: "6.28899.6",
    baseline: "6.28899.6",
    latest: "6.28999.1",
  });
  assert.equal(result.action, true);
  assert.ok(result.checks.some((item) => item.name === "new upstream version"));
});

test("requires action when the source has not been accepted into the baseline", () => {
  const result = assessUpstream({
    source: "6.28999.1",
    built: "6.28899.6",
    baseline: "6.28899.6",
    latest: "6.28999.1",
  });
  assert.equal(result.action, true);
  assert.ok(result.checks.some((item) => item.name === "source baseline"));
  assert.ok(result.checks.some((item) => item.name === "build baseline"));
});

test("offline mode checks only local versions", () => {
  const result = assessUpstream({
    source: "6.28899.6",
    built: "6.28899.6",
    baseline: "6.28899.6",
    latest: null,
    offline: true,
  });
  assert.equal(result.action, false);
  assert.ok(result.checks.some((item) => item.status === "SKIP"));
});
