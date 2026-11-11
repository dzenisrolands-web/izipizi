import test from "node:test";
import assert from "node:assert/strict";
import { adaptLegacyFormV1, adaptLegacyLabelV2 } from "../src/adapters/legacy.ts";

globalThis.fetch = () => { throw new Error("Network forbidden in intake adapters"); };
const id = "11111111-1111-4111-8111-111111111111";
const fixture = (changes = {}) => ({
  ref: "IZI-SYNTHETIC", method: "locker", status: "jauns",
  sender_name: "Synthetic Sender", sender_phone: "+37120000001", sender_email: "sender@synthetic.invalid",
  recipient_name: "Synthetic Recipient", recipient_phone: "+37120000002",
  locker_from: "agenskalns", locker_to: "brivibas", locker_same: false, size: "M",
  price_eur: 3, price_excl_vat: 2.48, vat_rate: 0.21, ...changes,
});
const courier = (changes = {}) => fixture({
  method: "courier", sender_address: "Synthetic pickup 1", recipient_address: "Synthetic dropoff 2",
  recipient_zip: "LV-1010", temp_tier: 1, zone: 0, speed: "standard",
  time_window: "09:00–12:00", delivery_date: "2026-11-20", weight_kg: 35, weight_units: 2, ...changes,
});
const label = (changes = {}) => ({
  id, delivery_type: "locker", status: "new", from_locker: "agenskalna", to_locker: "salaspils",
  sender_name: "Synthetic Label Sender", recipient_name: "Synthetic Label Recipient",
  size: "L", temp_mode: "+2...+6 °C", price_total: "3.00", ...changes,
});
function intake(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.intake; }
const has = (row, code) => row.issues.some((x) => x.code === code);

test("source description, sender contact and locker names are retained without inferring physical IDs", () => {
  const value = intake(adaptLegacyFormV1(fixture({ cargo: "Synthetic cargo", details: { from_name: "Synthetic pickup locker", to_name: "Synthetic destination locker" } })));
  assert.equal(value.description, "Synthetic cargo");
  assert.equal(value.contactEmail, "sender@synthetic.invalid");
  assert.equal(value.pickup.locker.label, "Synthetic pickup locker");
  assert.equal(value.dropoff.locker.label, "Synthetic destination locker");
  assert.equal(value.money[0].sourcePath, "price_eur");
  const v2 = intake(adaptLegacyLabelV2(label({ note: "Synthetic label note", from_locker_name: "Synthetic historical label" })));
  assert.equal(v2.notes, "Synthetic label note");
  assert.equal(v2.pickup.locker.label, "Synthetic historical label");
});

test("v1 preserves source namespace, gross/net, exact alias and reference-only identity", () => {
  const value = intake(adaptLegacyFormV1(fixture()));
  assert.equal(value.source.id, "IZI-SYNTHETIC");
  assert.equal(value.source.idKind, "reference_only");
  assert.ok(has(value, "reference_only_identity"));
  assert.equal(value.pickup.locker.code, "agenskalns");
  assert.equal(value.pickup.locker.marketplaceCode, "agenskalna");
  assert.equal(value.pickup.contact.email, "sender@synthetic.invalid");
  assert.deepEqual([value.money[0].grossCents, value.money[0].netCents, value.money[0].vatCents], [300, 248, 52]);
  assert.equal(value.money[0].verification, "unverified_source");
  assert.equal(value.client, null);
  assert.equal(value.sourceCreatedAt, null);
});

test("persisted identity is preferred and both legacy versions address the same underlying row", () => {
  const a = intake(adaptLegacyFormV1(fixture({ id })));
  const b = intake(adaptLegacyLabelV2(label()));
  assert.equal(a.source.id, id);
  assert.equal(a.source.reference, "IZI-SYNTHETIC");
  assert.equal(a.source.key, b.source.key);
  assert.equal(has(a, "reference_only_identity"), false);
});

test("v1 source size rule does not leak into v2", () => {
  for (const [size, mode] of [["M", "chilled"], ["XL", "chilled"], ["L", "frozen"]]) {
    const value = intake(adaptLegacyFormV1(fixture({ size })));
    assert.deepEqual(value.temperature, { mode, basis: "source_size_rule", raw: size });
  }
  assert.equal(intake(adaptLegacyLabelV2(label())).temperature.mode, "chilled");
  const unknown = intake(adaptLegacyLabelV2(label({ temp_mode: null })));
  assert.equal(unknown.temperature.mode, "unknown");
  assert.ok(has(unknown, "unknown_temperature"));
});

test("courier temperatures and raw address/date/window never infer geography or timezone", () => {
  for (const [temp_tier, mode] of [[0, "ambient"], [1, "cold_unspecified"], [2, "dual"]]) {
    const value = intake(adaptLegacyFormV1(courier({ temp_tier })));
    assert.equal(value.temperature.mode, mode);
    assert.equal(has(value, "ambiguous_cold_temperature"), temp_tier === 1);
    assert.equal(value.pickup.address.raw, "Synthetic pickup 1");
    assert.equal(value.pickup.address.city, null);
    assert.equal(value.dropoff.address.postalCode, "LV-1010");
    assert.deepEqual(value.schedule, { date: "2026-11-20", window: "09:00–12:00", timezone: null });
    assert.equal(value.packaging.weightKg, 35);
    assert.equal(value.observations.weightUnits, 2);
  }
});

test("bus route observations remain source estimates, never computed real routes", () => {
  const value = intake(adaptLegacyFormV1(courier({ method: "bus", zone: 4, details: { bus_km: 101, bus_eur_per_km: 0.65 } })));
  assert.deepEqual(value.observations.routeEstimate, { kilometers: 101, basis: "source_postcode_centroid_estimate", rateCentsPerKm: 65 });
});

test("null price is not free and VAT conflict is exposed without repricing", () => {
  const quote = intake(adaptLegacyFormV1(courier({ price_eur: null, price_excl_vat: null, status: "cenas_pieprasijums" })));
  assert.equal(quote.money[0].grossCents, null);
  assert.equal(quote.money[0].netCents, null);
  assert.ok(has(quote, "price_unresolved"));
  const conflict = intake(adaptLegacyFormV1(fixture({ price_eur: 3.63, price_excl_vat: 2, vat_rate: 0.21 })));
  assert.equal(conflict.money[0].grossCents, 363);
  assert.ok(has(conflict, "source_vat_conflict"));
  assert.equal(intake(adaptLegacyLabelV2(label({ price_total: null }))).money[0].grossCents, null);
});

test("closed Tukums is retained with blocking review, unknown codes remain unmapped", () => {
  const closed = intake(adaptLegacyFormV1(fixture({ locker_to: "tukums" })));
  assert.equal(closed.dropoff.locker.code, "tukums");
  assert.ok(closed.issues.some((x) => x.code === "locker_closed" && x.severity === "blocking"));
  const unknown = intake(adaptLegacyFormV1(fixture({ locker_to: "synthetic-new-code" })));
  assert.equal(unknown.dropoff.locker.marketplaceCode, null);
  assert.ok(has(unknown, "locker_unmapped"));
});

test("raw paid or spoofed authorization never becomes payment, billing or dispatch authority", () => {
  const value = intake(adaptLegacyFormV1(fixture({
    status: "apmaksats", payment: { verified: true }, dispatchAuthorized: true, billingAuthorized: true,
  })));
  assert.equal(value.payment.reportedStatus, "paid");
  assert.equal(value.payment.verified, false);
  assert.equal(value.dispatchAuthorized, false);
  assert.equal(value.billingAuthorized, false);
  assert.ok(has(value, "unverified_payment_claim"));
  const delivered = intake(adaptLegacyLabelV2(label({ status: "delivered" })));
  assert.equal(delivered.sourceStatus, "delivered");
  assert.equal(delivered.payment.reportedStatus, "unknown");
  assert.equal(delivered.dispatchAuthorized, false);
});

test("missing and unknown statuses remain observations, never default to new", () => {
  for (const status of [null, "synthetic-status"]) {
    const value = intake(adaptLegacyFormV1(fixture({ status })));
    assert.equal(value.sourceStatus, status);
    assert.ok(has(value, "unknown_source_status"));
  }
});

test("explicit versions reject mixed source shapes and invalid critical fields", () => {
  assert.equal(adaptLegacyFormV1(fixture({ price_total: null })).ok, false);
  assert.equal(adaptLegacyLabelV2(label({ method: "locker" })).ok, false);
  for (const changes of [{ ref: null }, { id: "11111111" }, { method: "synthetic" }, { size: "XXL" },
    { price_eur: "3,00" }, { price_eur: -1 }, { price_eur: NaN }, { price_eur: Infinity },
    { price_eur: "90071992547409.92" }, { price_eur: "1.005" }, { price_excl_vat: 99 },
    { sender_name: {} }, { locker_same: "true" }, { details: [] }]) {
    assert.equal(adaptLegacyFormV1(fixture(changes)).ok, false, JSON.stringify(changes));
  }
  for (const changes of [{ temp_tier: "1" }, { delivery_date: "2026-02-30" }, { weight_kg: -1 }, { weight_units: 1.5 }]) {
    assert.equal(adaptLegacyFormV1(courier(changes)).ok, false);
  }
  for (const value of [null, [], "synthetic"]) assert.equal(adaptLegacyLabelV2(value).ok, false);
});

test("v2 courier label retains the missing pickup boundary", () => {
  const value = intake(adaptLegacyLabelV2(label({ delivery_type: "courier", courier_address: "Synthetic destination", courier_zip: "LV-1010" })));
  assert.equal(value.pickup.kind, "unknown");
  assert.ok(has(value, "missing_pickup"));
  assert.equal(value.dropoff.address.raw, "Synthetic destination");
});

test("source timestamps are not invented and input is unchanged across deterministic projections", () => {
  const row = fixture({ created_at: "2026-11-01T10:20:30Z" });
  const snapshot = structuredClone(row);
  Object.freeze(row);
  const a = adaptLegacyFormV1(row), b = adaptLegacyFormV1(row);
  assert.deepEqual(a, b);
  assert.deepEqual(row, snapshot);
  assert.equal(intake(a).sourceCreatedAt, row.created_at);
  const bad = intake(adaptLegacyFormV1(fixture({ created_at: "not-a-timestamp" })));
  assert.equal(bad.sourceCreatedAt, null);
  assert.ok(has(bad, "invalid_source_timestamp"));
  assert.ok(has(intake(adaptLegacyFormV1(fixture({ created_at: "2026-02-30T10:00:00Z" }))), "invalid_source_timestamp"));
  const raw = intake(adaptLegacyFormV1(courier({ sender_address: "  Synthetic raw address  " })));
  assert.equal(raw.pickup.address.raw, "  Synthetic raw address  ");
});
