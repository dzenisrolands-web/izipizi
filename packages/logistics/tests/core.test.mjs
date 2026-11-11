import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEuroCents, parseIntegerCents, sourceReference, observedMoney,
  lockerReference, unknownEndpoint, unknownTemperature, createIntake,
} from "../src/index.ts";

globalThis.fetch = () => { throw new Error("Intake contract must not access any network"); };

test("EUR source decimals preserve cents exactly and never manufacture zero from missing data", () => {
  for (const [source, cents] of [[3, 300], ["3", 300], ["3.00", 300], ["3.63", 363], [2.48, 248], [0, 0]]) {
    assert.equal(parseEuroCents(source), cents);
  }
  assert.equal(parseEuroCents(null), null);
  assert.equal(parseEuroCents(undefined), null);
  for (const invalid of ["", " ", "3,00", "-1", "1e2", "03", "1.005", {}, NaN, Infinity, -1, 1.005, Number.MAX_VALUE]) {
    assert.throws(() => parseEuroCents(invalid));
  }
  assert.equal(parseEuroCents("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseEuroCents("90071992547409.92"));
  assert.throws(() => parseEuroCents("9".repeat(10000)));
  assert.throws(() => parseIntegerCents("300"));
});

test("recorded gross/net/tax and source channels remain distinct", () => {
  assert.equal(observedMoney("legacy_logistics", 300, 248, 52).grossCents, 300);
  assert.equal(observedMoney("website_logistics", 363, 300, 63).grossCents, 363);
  assert.equal(observedMoney("marketplace_delivery", null).grossCents, null);
  assert.throws(() => observedMoney("legacy_logistics", 300, 300, 63));
  assert.throws(() => observedMoney("legacy_logistics", 300, 400));
});

test("full IDs remain namespaced; label/form versions do not duplicate the same legacy row", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const a = sourceReference("legacy-form-v1", id, "IZI-TEST");
  const b = sourceReference("legacy-label-v2", id);
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, sourceReference("website-neon-v1", id).key);
  assert.notEqual(a.key, sourceReference("marketplace-order-v1", id).key);
  assert.equal(sourceReference("legacy-form-v1", "IZI-TEST", "IZI-TEST", "reference_only").idKind, "reference_only");
  for (const value of ["11111111", "", "../unsafe", "customer@example.invalid"]) {
    assert.throws(() => sourceReference("website-neon-v1", value));
  }
  assert.throws(() => sourceReference("legacy-form-v1", "IZI-TEST", null, "forged"));
});

test("locker aliases preserve origin and do not infer UUIDs or reopen Tukums", () => {
  const alias = lockerReference("legacy-form-v1", "agenskalns");
  assert.equal(alias.code, "agenskalns");
  assert.equal(alias.marketplaceCode, "agenskalna");
  assert.equal(lockerReference("legacy-form-v1", "tukums").availability, "closed_for_new_work");
  assert.equal(lockerReference("website-neon-v1", "rix-agenskalna-tirgus").availability, "unmapped");
});

test("projection flags stay false even if caller supplies unauthorized extra fields", () => {
  const intake = createIntake({
    source: sourceReference("legacy-form-v1", "IZI-TEST", null, "reference_only"),
    sourceStatus: "apmaksats", method: "courier", client: null,
    pickup: unknownEndpoint(), dropoff: unknownEndpoint(), temperature: unknownTemperature(),
    packaging: { sizeCode: null, weightKg: null },
    schedule: { date: null, window: null, timezone: null },
    money: [], payment: { reportedStatus: "paid", raw: "apmaksats", verified: true },
    parts: [], issues: [], dispatchAuthorized: true, billingAuthorized: true,
  });
  assert.equal(intake.dispatchAuthorized, false);
  assert.equal(intake.billingAuthorized, false);
  assert.equal(intake.payment.verified, false);
  assert.throws(() => { intake.dispatchAuthorized = true; });
  assert.throws(() => { intake.payment.verified = true; });
});
