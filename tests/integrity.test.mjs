import assert from "node:assert/strict";
import test from "node:test";
import { integrityDictionaryDigest } from "../scripts/patch-app.mjs";

test("dictionary digest is key-order independent", () => {
  const a = {
    "Resources/app.asar": {
      algorithm: "SHA256",
      hash: "8c7b5866d32edb4674ac3104b01cf5bb88093713556a9214e14aa6365583f98c",
    },
    "Resources/ion-dist.asar": {
      algorithm: "SHA256",
      hash: "5110966f9dda5cbaee68e239d50049f16b17aef362e00f8ed4e30a072ed595a1",
    },
  };
  const b = {
    "Resources/ion-dist.asar": a["Resources/ion-dist.asar"],
    "Resources/app.asar": a["Resources/app.asar"],
  };
  assert.equal(
    integrityDictionaryDigest(a),
    "361212f826dcdb56e20da23711af9d9c11b6fbcc7bfa4a7d7cfbed9422bf31d5",
  );
  assert.equal(integrityDictionaryDigest(a), integrityDictionaryDigest(b));
});
