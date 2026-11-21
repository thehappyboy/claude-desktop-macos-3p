import assert from "node:assert/strict";
import test from "node:test";
import { patchSource } from "../scripts/patch-app.mjs";

const fixture = [
  "function uIr(){return 1}",
  "function eBr(){return 0}",
  "function qzr(){return!1}",
  "function WP(e={}){if(!uIr()||eBr())return!1;if(qzr())return!0;let t=1;return!1}",
  "function GP(e={}){return!nP()||!uIr()||Gy()||eBr()?!1:WP(e)&&Fy(`chicagoEnabled`)}",
  "function iBr(e={}){return nP()&&WP(e)&&!Fy(`chicagoEnabled`)&&Fy(`chicagoOffOverDefault`)!==!0}",
  "function Tsi(e){if(!uIr())return h2e()?{status:`unsupported`}:{status:`unsupported`};let t=1;return{status:`unavailable`}}",
  'function KP(e={}){let t=e.requireFreshGrowthBook??!0;if(process.platform!=="darwin")return!1;let n=Uk();return n.major<15||Vzr(n,Bzr())||t&&!UP()?!1:Mb(HP,"appScopedEnabled",!1,k())}',
].join("");

test("patches all five gates once", () => {
  const { source, applied } = patchSource(fixture);
  assert.deepEqual(applied.sort(), ["appscoped", "enabled", "optedout", "rollout", "status"]);
  assert.match(source, /__macCu3P_rollout/);
  assert.match(source, /__macCu3P_enabled/);
  assert.match(source, /__macCu3P_optedout/);
  assert.match(source, /__macCu3P_status/);
  assert.match(source, /__macCu3P_appscoped/);
  assert.match(source, /process\.platform==="darwin"&&K\(\)\.type==="3p"/);
});

test("is idempotent", () => {
  const once = patchSource(fixture).source;
  const twice = patchSource(once);
  assert.deepEqual(twice.applied, []);
  assert.equal(twice.source, once);
});

test("fails closed when an anchor is missing", () => {
  const broken = fixture.replace("chicagoOffOverDefault", "chicagoOtherPreference");
  assert.throws(() => patchSource(broken), /expected exactly one anchor/);
});
