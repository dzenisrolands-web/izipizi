import test from "node:test";
import assert from "node:assert/strict";
import {
  createIntake, sourceReference, unknownEndpoint, unknownTemperature, observedMoney, issue,
} from "../src/core.ts";
import { reviewIntakes } from "../src/review.ts";

globalThis.fetch = () => { throw new Error("Offline review must not call providers"); };

function candidate(overrides = {}) {
  return { ok: true, intake: createIntake({
    source: sourceReference("legacy-form-v1", "IZI-TEST", "PRIVATE REFERENCE", "reference_only"),
    sourceStatus: "jauns", method: "courier", client: null,
    pickup: unknownEndpoint({ name: "Private sender", phone: "+37120000000", email: "private@example.invalid" }),
    dropoff: { ...unknownEndpoint(), kind: "address", address: { raw: "PRIVATE STREET", street: null, city: null, postalCode: null } },
    temperature: unknownTemperature(), packaging: { sizeCode: null, weightKg: null },
    schedule: { date: null, window: null, timezone: null }, money: [],
    payment: { reportedStatus: "pending", raw: "jauns", verified: false },
    parts: [], issues: [issue("REQUIRES_REVIEW", "pickup", "Private details must not enter summary")],
    ...overrides,
  }) };
}

test("exact duplicates are batch observations, not duplicate jobs", () => {
  const record = candidate();
  const review = reviewIntakes([record, record]);
  assert.equal(review.uniqueSources, 1);
  assert.equal(review.normalizedSources, 1);
  assert.equal(review.duplicateRecords, 1);
  assert.equal(review.rows[1].duplicateOf, 0);
  assert.equal(review.dispatchAuthorized, false);
  assert.equal(review.billingAuthorized, false);
});

test("a later conflicting version marks the entire identity group for review", () => {
  const record = candidate();
  const changed = candidate({ sourceStatus: "apmaksats" });
  const review = reviewIntakes([record, record, changed]);
  assert.equal(review.conflictingSources, 1);
  assert.equal(review.conflictingRecords, 3);
  assert.equal(review.normalizedSources, 0);
  assert.equal(review.duplicateRecords, 0);
  assert.deepEqual(review.rows.map(row => row.disposition), ["conflict", "conflict", "conflict"]);
});

test("object-key order does not create false conflicts, but array order remains meaningful", () => {
  const record = candidate();
  const reordered = { ok: true, intake: Object.fromEntries(Object.entries(record.intake).reverse()) };
  assert.equal(reviewIntakes([record, reordered]).duplicateRecords, 1);
  const first = candidate({ money: [observedMoney("legacy_logistics", 300), observedMoney("website_logistics", 363)] });
  const second = candidate({ money: [...first.intake.money].reverse() });
  assert.equal(reviewIntakes([first, second]).conflictingSources, 1);
});

test("default review does not leak contacts, addresses, human references or source keys", () => {
  const record = candidate();
  const summary = JSON.stringify(reviewIntakes([record]));
  for (const privateValue of ["Private sender", "+37120000000", "private@example.invalid", "PRIVATE STREET", "PRIVATE REFERENCE", "IZI-TEST"]) {
    assert.ok(!summary.includes(privateValue), privateValue);
  }
  assert.equal(reviewIntakes([record], { includeSourceKeys: true }).rows[0].sourceKey, record.intake.source.key);
  assert.equal(reviewIntakes([record], { includeSourceKeys: "true" }).rows[0].sourceKey, undefined);
});

test("invalid adapters and forged projection flags remain invalid, never operational", () => {
  const record = candidate();
  const invalid = { ok: false, schema: "legacy-form-v1", issues: [issue("BAD_RECORD", "id", "Not a shipment")] };
  const forged = { ok: true, intake: { ...record.intake, dispatchAuthorized: true } };
  const cycle = { ...record.intake };
  cycle.extra = cycle;
  const review = reviewIntakes([invalid, forged, { ok: true, intake: cycle }]);
  assert.equal(review.invalidRecords, 3);
  assert.ok(review.rows.every(row => !row.dispatchAuthorized && !row.billingAuthorized));
  assert.throws(() => reviewIntakes(Array(1001).fill(record)), RangeError);
});

test("source namespaces remain distinct and legacy version changes are not imported twice", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const legacy = candidate({ source: sourceReference("legacy-form-v1", id) });
  const website = candidate({ source: sourceReference("website-neon-v1", id) });
  const label = candidate({ source: sourceReference("legacy-label-v2", id) });
  assert.equal(reviewIntakes([legacy, website]).uniqueSources, 2);
  assert.equal(reviewIntakes([legacy, label]).conflictingSources, 1);
});
