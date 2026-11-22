import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { patchSource } from "../scripts/patch-app.mjs";

const fixture = `
function uIr(){return T.uIr}
function eBr(){return T.eBr}
function qzr(){return T.qzr}
function UP(){return T.fresh}
function Eb(){return T.fresh}
function wzr(){return T.wzr}
function Xzr(){return T.rolloutEnabled}
function Yzr(){return []}
function Zzr(){return true}
function X(){return true}
function WP(e={}){if(!uIr()||eBr())return!1;if(qzr())return!0;let t=UP();if(!(e.requireFreshGrowthBook??!0?t:Eb())||!wzr()||process.platform==="linux"&&!X("3676943315")||process.platform==="win32"&&!X("40173473"))return!1;if(Xzr())return!0;if(e.linkedCaller===void 0)return!1;let n=Yzr();return(e.linkedCaller==="any"?n.length>0:n.includes(e.linkedCaller))&&Zzr?.()===!0}
function nP(){return T.platform}
function Gy(){return T.hipaa}
function Fy(k){return T.prefs[k]}
function GP(e={}){return!nP()||!uIr()||Gy()||eBr()?!1:WP(e)&&Fy("chicagoEnabled")}
function iBr(e={}){return nP()&&WP(e)&&!Fy("chicagoEnabled")&&Fy("chicagoOffOverDefault")!==!0}
function h2e(){return T.unread}
function qR(k,d){return T.flags[k]??d}
function nBr(){return false}
function Tsi(e){if(!uIr())return h2e()?{status:"unsupported",reason:"unread"}:{status:"unsupported",reason:"off"};let t=qR("computerUseRolloutFetched",Eb);return qR(e,e==="computerUseLocal"?nBr:t)?{status:"supported"}:t?{status:"unsupported",reason:"not_enabled"}:{status:"unavailable"}}
function Uk(){return{major:T.macos}}
function Vzr(){return false}
function Bzr(){return false}
function Mb(){return false}
const HP="hp";
function k(){return{}}
function KP(e={}){let t=e.requireFreshGrowthBook??!0;if(process.platform!=="darwin")return!1;let n=Uk();return n.major<15||Vzr(n,Bzr())||t&&!UP()?!1:Mb(HP,"appScopedEnabled",!1,k())}
function K(){return T.mode}
`;

const base = {
  uIr: true,
  eBr: false,
  qzr: false,
  fresh: true,
  wzr: true,
  rolloutEnabled: true,
  platform: true,
  hipaa: false,
  unread: false,
  prefs: { chicagoEnabled: true },
  flags: { computerUseRolloutFetched: true },
  macos: 15,
  mode: { type: "3p" },
};

function load(source, overrides = {}) {
  const T = {
    ...base,
    ...overrides,
    prefs: { ...base.prefs, ...(overrides.prefs || {}) },
    flags: { ...base.flags, ...(overrides.flags || {}) },
  };
  const context = {
    T,
    process: { platform: "darwin" },
    console,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.api={WP,GP,iBr,Tsi,KP};`, context);
  return context.api;
}

function patched(overrides = {}) {
  const { source } = patchSource(fixture);
  return load(source, overrides);
}

test("patches only the rollout, status and app-scoped gates", () => {
  const { source, applied } = patchSource(fixture);
  assert.deepEqual(applied.sort(), ["appscoped", "rollout", "status"]);
  assert.match(source, /__macCu3P_rollout/);
  assert.match(source, /__macCu3P_status/);
  assert.match(source, /__macCu3P_appscoped/);
  assert.doesNotMatch(source, /__macCu3P_enabled/);
  assert.doesNotMatch(source, /__macCu3P_optedout/);
});

test("3P on macOS enables Computer Use and keeps the user-off state visible", () => {
  const normal = patched();
  assert.equal(normal.GP(), true);
  assert.equal(normal.iBr(), false);
  assert.equal(normal.Tsi("computerUseRollout").status, "supported");

  const off = patched({ prefs: { chicagoEnabled: false } });
  assert.equal(off.GP(), false);
  assert.equal(off.iBr(), true);
  assert.equal(off.Tsi("computerUseRollout").status, "supported");
});

test("managed computerUseEnabled=false still turns Computer Use off", () => {
  const disabled = patched({ uIr: false });
  assert.equal(disabled.WP({ linkedCaller: "any" }), false);
  assert.equal(disabled.GP(), false);
  assert.equal(disabled.Tsi("computerUseRollout").status, "unsupported");
  assert.equal(disabled.Tsi("computerUseRollout").reason, "off");
});

test("unreadable allowed-apps settings still turn Computer Use off", () => {
  const unreadable = patched({ eBr: true });
  assert.equal(unreadable.WP({ linkedCaller: "any" }), false);
  assert.equal(unreadable.GP(), false);
  assert.notEqual(unreadable.Tsi("computerUseRollout").status, "supported");
});

test("unreadable denied-apps settings still turn Computer Use off", () => {
  const unreadable = patched({ wzr: false });
  assert.equal(unreadable.WP({ linkedCaller: "any" }), false);
  assert.equal(unreadable.GP(), false);
  assert.notEqual(unreadable.Tsi("computerUseRollout").status, "supported");
});

test("HIPAA remains a deny at the enabled gate when the harness reports it", () => {
  const hipaa = patched({ hipaa: true });
  assert.equal(hipaa.GP(), false);
});

test("app-scoped mode is enabled only on macOS 15+ in 3P", () => {
  assert.equal(patched({ mode: { type: "3p" }, macos: 15 }).KP(), true);
  assert.equal(patched({ mode: { type: "3p" }, macos: 14 }).KP(), false);
  assert.equal(patched({ mode: { type: "1p" }, macos: 15 }).KP(), false);
});

test("1P behavior is not forced by the 3P patch", () => {
  const oneP = patched({
    mode: { type: "1p" },
    rolloutEnabled: false,
    flags: { computerUseRolloutFetched: false },
  });
  assert.equal(oneP.WP({ linkedCaller: "any" }), false);
  assert.equal(oneP.GP(), false);
  assert.equal(oneP.Tsi("computerUseRollout").status, "unavailable");
});

test("is idempotent", () => {
  const once = patchSource(fixture).source;
  const twice = patchSource(once);
  assert.deepEqual(twice.applied, []);
  assert.equal(twice.source, once);
});

test("rejects stale output from the old policy-bypassing patch", () => {
  assert.throws(
    () => patchSource(`${fixture}/*__macCu3P_enabled*/`),
    /Stale enabled patch/,
  );
  assert.throws(
    () => patchSource(`${fixture}/*__macCu3P_optedout*/`),
    /Stale optedout patch/,
  );
});

test("fails closed when an anchor is missing", () => {
  const broken = fixture.replace(
    "if(!uIr()||eBr())return!1;",
    "if(!uIr())return!1;",
  );
  assert.throws(() => patchSource(broken), /expected exactly one anchor/);
});
