import test from "node:test";
import assert from "node:assert/strict";
import { adaptWebsiteNeonV1 } from "../src/adapters/website.ts";
import { adaptLegacyFormV1 } from "../src/adapters/legacy.ts";

globalThis.fetch = () => { throw new Error("Network forbidden in intake adapters"); };
const id = "22222222-2222-4222-8222-222222222222";
const endpoint = (changes = {}) => ({
  kind: "address", name: "Synthetic Contact", phone: "+37120000003", email: "contact@synthetic.invalid",
  address: "Synthetic street 1", city: "Synthetic City", postalCode: "LV-1010", ...changes,
});

test("missing required Neon contacts and structured address fields never appear clean", () => {
  const value = intake(adaptWebsiteNeonV1(fixture({
    sender: endpoint({ name: null, phone: null, city: null }),
    recipient: endpoint({ phone: null, postalCode: null }),
  })));
  for (const code of ["missing_contact", "incomplete_address"]) {
    assert.equal(value.issues.filter(entry => entry.code === code && entry.severity === "blocking").length, 2);
  }
  assert.equal(value.pickup.contact.phone, null);
  assert.equal(value.dropoff.address.postalCode, null);
  assert.equal(value.dispatchAuthorized, false);
});
const fixture = (changes = {}) => ({
  id, status: "new", method: "standard", zone: "z0", temp_mode: "none", compartment_size: null,
  time_window: "09:00–12:00", price_net: "4.50", price_gross: "5.45", vat_rate: "0.21",
  sender: endpoint(), recipient: endpoint({ address: "Synthetic street 2" }),
  contact_email: "customer@synthetic.invalid", ...changes,
});
function intake(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.intake; }
const has = (value, code) => value.issues.some((x) => x.code === code);

test("description, notes and independent confirmation contact are not turned into a client account", () => {
  const row = fixture({ description: "Synthetic parcel", notes: "Synthetic instructions" });
  const value = intake(adaptWebsiteNeonV1(row));
  assert.equal(value.description, "Synthetic parcel");
  assert.equal(value.notes, "Synthetic instructions");
  assert.equal(value.contactEmail, "customer@synthetic.invalid");
  assert.equal(value.money[0].sourcePath, "price_gross");
  assert.equal(value.client, null);
  assert.equal(adaptWebsiteNeonV1(fixture({ contactEmail: "different@synthetic.invalid" })).ok, false);
});

test("Neon order preserves UUID, contacts, strings, explicit temperature and unknown client", () => {
  const value = intake(adaptWebsiteNeonV1(fixture({ temp_mode: "both", created_at: "2026-11-01T10:00:00Z" })));
  assert.equal(value.source.id, id);
  assert.equal(value.source.system, "website_neon");
  assert.equal(value.sourceCreatedAt, "2026-11-01T10:00:00Z");
  assert.equal(value.temperature.mode, "dual");
  assert.equal(value.money[0].grossCents, 545);
  assert.equal(value.money[0].netCents, 450);
  assert.equal(value.money[0].rawGross, "5.45");
  assert.equal(value.observations.sourceVatRate, "0.21");
  assert.equal(value.pickup.contact.email, "contact@synthetic.invalid");
  assert.equal(value.dropoff.address.raw, "Synthetic street 2");
  assert.equal(value.client, null);
  assert.deepEqual(value.schedule, { date: null, window: "09:00–12:00", timezone: null });
});

test("known Drizzle aliases are supported with exact conflict rejection", () => {
  const row = fixture();
  for (const [snake, camel] of [["temp_mode", "tempMode"], ["compartment_size", "compartmentSize"],
    ["time_window", "timeWindow"], ["price_net", "priceNet"], ["price_gross", "priceGross"], ["vat_rate", "vatRate"]]) {
    row[camel] = row[snake]; delete row[snake];
  }
  assert.equal(intake(adaptWebsiteNeonV1(row)).money[0].grossCents, 545);
  assert.equal(adaptWebsiteNeonV1(fixture({ priceGross: "99.00" })).ok, false);
  assert.equal(adaptWebsiteNeonV1(fixture({ tempMode: "frozen" })).ok, false);
  assert.equal(adaptWebsiteNeonV1(fixture({ created_at: "2026-11-01T00:00:00Z", createdAt: "2026-11-02T00:00:00Z" })).ok, false);
  assert.equal(adaptWebsiteNeonV1(fixture({ priceGross: "5.45" })).ok, true);
  assert.equal(intake(adaptWebsiteNeonV1(fixture({ createdAt: new Date("2026-11-01T10:00:00Z") }))).sourceCreatedAt, "2026-11-01T10:00:00.000Z");
});

test("Neon gross 3.63 is never replaced by legacy locker gross 3.00", () => {
  const value = intake(adaptWebsiteNeonV1(fixture({
    method: "pakomats", compartment_size: "M", temp_mode: "chilled", price_net: "3", price_gross: "3.63",
    sender: endpoint({ kind: "locker", lockerId: "rix-agenskalna-tirgus" }),
    recipient: endpoint({ kind: "locker", lockerId: "salaspils-zviedru" }),
  })));
  assert.equal(value.money[0].grossCents, 363);
  assert.equal(value.pickup.locker.code, "rix-agenskalna-tirgus");
  assert.equal(value.pickup.locker.marketplaceCode, null);
  assert.ok(has(value, "locker_unmapped"));
  assert.equal(value.temperature.basis, "explicit_source");
});

test("quote-required prices and unknown temperature remain unresolved", () => {
  const value = intake(adaptWebsiteNeonV1(fixture({ method: "express", zone: "z3", price_net: null, price_gross: null, temp_mode: null })));
  assert.equal(value.method, "express");
  assert.equal(value.money[0].grossCents, null);
  assert.equal(value.temperature.mode, "unknown");
  assert.ok(has(value, "price_unresolved"));
  assert.ok(has(value, "unknown_temperature"));
});

test("business lead never creates a shipment or client, extra account-looking data grants nothing", () => {
  assert.equal(adaptWebsiteNeonV1({ company: { name: "Synthetic Co" } }, "business_lead").ok, false);
  const value = intake(adaptWebsiteNeonV1(fixture({
    client_id: id, company: { name: "Synthetic Co" }, payment: { verified: true },
    billingAuthorized: true, dispatchAuthorized: true, status: "paid",
  })));
  assert.equal(value.client, null);
  assert.equal(value.sourceStatus, "paid");
  assert.equal(value.payment.reportedStatus, "paid");
  assert.equal(value.payment.verified, false);
  assert.equal(value.dispatchAuthorized, false);
  assert.equal(value.billingAuthorized, false);
  assert.ok(has(value, "unknown_source_status"));
  assert.ok(has(value, "unverified_payment_claim"));
});

test("malformed identity, money, endpoints and methods cannot become a canonical success", () => {
  assert.equal(adaptWebsiteNeonV1(fixture({ price_eur: 3 })).ok, false);
  for (const changes of [{ id: "22222222" }, { id: null }, { method: "locker" }, { sender: null },
    { recipient: { kind: "synthetic" } }, { price_gross: "5,45" }, { price_gross: NaN },
    { price_gross: "1e3" }, { price_net: "9" }, { vat_rate: "-0.21" }, { zone: 0 }]) {
    assert.equal(adaptWebsiteNeonV1(fixture(changes)).ok, false, JSON.stringify(changes));
  }
  assert.equal(adaptWebsiteNeonV1(fixture({ method: "pakomats", compartment_size: null })).ok, false);
  for (const row of [null, [], 4]) assert.equal(adaptWebsiteNeonV1(row).ok, false);
});

test("source statuses and missing critical endpoint observations are explicit review issues", () => {
  const value = intake(adaptWebsiteNeonV1(fixture({ status: null, recipient: endpoint({ address: null }) })));
  assert.equal(value.sourceStatus, null);
  assert.ok(has(value, "unknown_source_status"));
  assert.ok(value.issues.some((x) => x.code === "missing_address" && x.severity === "blocking"));
});

test("source namespaces prevent UUID collisions and projections are deterministic without mutation", () => {
  const row = fixture(), snapshot = structuredClone(row);
  Object.freeze(row.sender); Object.freeze(row.recipient); Object.freeze(row);
  assert.deepEqual(adaptWebsiteNeonV1(row), adaptWebsiteNeonV1(row));
  assert.deepEqual(row, snapshot);
  const legacy = intake(adaptLegacyFormV1({
    id, ref: "IZI-SYNTHETIC-NEON", method: "locker", status: "jauns", locker_from: "agenskalns",
    locker_to: "salaspils", size: "M", price_eur: 3, price_excl_vat: 2.48, vat_rate: 0.21,
  }));
  assert.notEqual(intake(adaptWebsiteNeonV1(row)).source.key, legacy.source.key);
});
