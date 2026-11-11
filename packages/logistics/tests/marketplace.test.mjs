import test from "node:test";
import assert from "node:assert/strict";
import { adaptMarketplaceOrderV1 } from "../src/adapters/marketplace.ts";

globalThis.fetch = () => { throw new Error("Marketplace projection must remain offline"); };
const ORDER = "11111111-1111-4111-8111-111111111111";
const SELLER_A = "22222222-2222-4222-8222-222222222222";
const SELLER_B = "33333333-3333-4333-8333-333333333333";
const BUYER = "44444444-4444-4444-8444-444444444444";
const LISTING = "55555555-5555-4555-8555-555555555555";

function fixture() {
  return {
    id: ORDER, order_number: "TRG-SYNTHETIC", created_at: "2026-11-01T12:00:00Z",
    status: "processing", payment_status: "paid", payment_provider: "paysera",
    payment_session_id: "TRG-SYNTHETIC", buyer_id: BUYER,
    buyer_name: "Synthetic recipient", buyer_phone: "+37100000000", buyer_email: "recipient@example.invalid",
    delivery_type: "express", total_cents: 2774, total_amount: 27.74, promo_discount_cents: 0,
    seller_ids: [SELLER_A],
    delivery_info: {
      address: "Synthetic street 1", city: "Synthetic city", postal_code: "LV-0000",
      address_search: "Synthetic street 1, Synthetic city", apartment: "2", floor: "3", entry_code: "TEST",
      delivery_date: "2026-11-12", time_slot: "09:00–12:00", delivery_fee_cents: 774,
      delivery_fees_by_seller: [{
        sellerId: SELLER_A, method: "express", totalCents: 774, feeCents: 774, netCents: 640, vatCents: 134,
        tariffVersion: "synthetic-v1", zonePolicy: "published-destination-postcode-v1",
      }],
    },
    items: [{
      id: LISTING, listing_id: LISTING, variant_id: "variant-a", cart_item_id: "synthetic-cart-a",
      seller_id: SELLER_A, sellerId: SELLER_A, title: "Synthetic item", price: 10, quantity: 2,
      storage_type: "chilled", category: "Synthetic category",
    }],
    seller_confirmations: { [SELLER_A]: { confirmed_at: "2026-11-02T08:00:00Z" } },
  };
}

function snapshot(sellerId = SELLER_A) {
  return {
    sellerId, name: "Synthetic sender", email: "sender@example.invalid",
    pickup: {
      kind: "address", contact: { name: "Synthetic sender", phone: null, email: "sender@example.invalid" },
      address: { raw: "Synthetic pickup", street: "Synthetic pickup", city: "Synthetic city", postalCode: "LV-0000" },
      locker: null,
    },
  };
}

function intake(row = fixture(), snapshots = [snapshot()]) {
  const result = adaptMarketplaceOrderV1(row, snapshots);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.intake;
}

function hasIssue(result, code) {
  return (result.ok ? result.intake.issues : result.issues).some(entry => entry.code === code);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("full UUID, human reference, nullable buyer and source status remain distinct observations", () => {
  const result = intake();
  assert.equal(result.source.id, ORDER);
  assert.equal(result.source.reference, "TRG-SYNTHETIC");
  assert.equal(result.source.key, `marketplace/persisted_id/${ORDER}`);
  assert.equal(result.sourceCreatedAt, "2026-11-01T12:00:00Z");
  assert.deepEqual(result.client, { namespace: "supabase_auth", id: BUYER, verification: "source_observation" });
  assert.equal(result.sourceStatus, "processing");
  assert.equal(result.payment.raw, "paid");
  assert.equal(result.payment.verified, false);
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.billingAuthorized, false);
  const guest = fixture(); guest.buyer_id = null;
  assert.equal(intake(guest).client, null);
});

test("express, explicit address details and schedule are preserved without timezone invention", () => {
  const result = intake();
  assert.equal(result.method, "express");
  assert.equal(result.dropoff.kind, "address");
  assert.equal(result.dropoff.address.entryCode, "TEST");
  assert.equal(result.dropoff.address.postalCode, "LV-0000");
  assert.deepEqual(result.schedule, { date: "2026-11-12", window: "09:00–12:00", timezone: null });
  assert.deepEqual(result.packaging, { sizeCode: null, weightKg: null });
  assert.equal(result.parts[0].pickup.kind, "address");
  assert.equal(result.parts[0].pickup.contact.phone, null);
  assert.equal(result.parts[0].senderConfirmation.recordedAt, "2026-11-02T08:00:00Z");
  assert.equal(result.parts[0].senderConfirmation.verification, "unverified_source");
});

test("money retains separate order/goods/delivery scopes and immutable item identities", () => {
  const result = intake();
  const sumFor = scope => result.money.filter(value => value.scope === scope).map(value => value.grossCents);
  assert.deepEqual(sumFor("marketplace_order_total"), [2774]);
  assert.deepEqual(sumFor("marketplace_goods"), [2000]);
  assert.deepEqual(sumFor("marketplace_delivery"), [774, 774]);
  assert.equal(result.parts[0].deliveryCharge.grossCents, 774);
  assert.equal(result.parts[0].deliveryCharge.netCents, 640);
  assert.equal(result.parts[0].deliveryCharge.sellerId, SELLER_A);
  assert.equal(result.parts[0].deliveryCharge.tariffVersion, "synthetic-v1");
  assert.equal(result.parts[0].deliveryCharge.zonePolicy, "published-destination-postcode-v1");
  assert.equal(result.parts[0].deliveryCharge.discountTreatment, "before_order_discount");
  assert.equal(result.parts[0].items[0].listingId, LISTING);
  assert.equal(result.parts[0].items[0].variantId, "variant-a");
  assert.equal(result.parts[0].items[0].cartItemId, "synthetic-cart-a");
  assert.equal(result.parts[0].items[0].unitGrossCents, 1000);
  assert.equal(result.parts[0].key, `marketplace/persisted_id/${ORDER}/seller/${SELLER_A}`);
});

test("multi-seller dual temperatures preserve source groups rather than automatic jobs", () => {
  const row = fixture();
  row.seller_ids.push(SELLER_B);
  row.items.push({ ...row.items[0], seller_id: SELLER_B, sellerId: SELLER_B, variant_id: "variant-b", cart_item_id: "synthetic-cart-b", storage_type: "frozen" });
  row.delivery_info.delivery_fees_by_seller.push({ sellerId: SELLER_B, feeCents: 300, netCents: null, vatCents: null });
  row.delivery_info.delivery_fee_cents += 300;
  const result = intake(row, [snapshot(), snapshot(SELLER_B)]);
  assert.equal(result.parts.length, 2);
  assert.deepEqual(result.parts.map(part => part.temperature.mode), ["chilled", "frozen"]);
  assert.equal(result.temperature.mode, "dual");
  assert.equal(result.parts[1].deliveryCharge.netCents, null);
  assert.equal(result.parts[1].deliveryCharge.vatCents, null);
  assert.equal(result.parts[1].senderConfirmation, null);
  assert.equal(result.dispatchAuthorized, false);
});

test("input rows and seller snapshots are not mutated and source array reorder is deterministic", () => {
  const row = fixture();
  row.seller_ids.push(SELLER_B);
  row.items.push({ ...row.items[0], seller_id: SELLER_B, sellerId: SELLER_B, cart_item_id: "synthetic-cart-b", storage_type: "frozen" });
  row.delivery_info.delivery_fees_by_seller.push({ sellerId: SELLER_B, totalCents: 300 });
  row.delivery_info.delivery_fee_cents = 1074;
  const snapshots = [snapshot(), snapshot(SELLER_B)];
  const before = structuredClone(row);
  const first = adaptMarketplaceOrderV1(freeze(row), freeze(snapshots));
  assert.deepEqual(row, before);
  const reordered = structuredClone(before);
  reordered.items.reverse(); reordered.seller_ids.reverse(); reordered.delivery_info.delivery_fees_by_seller.reverse();
  assert.deepEqual(first, adaptMarketplaceOrderV1(reordered, [...snapshots].reverse()));
});

test("promo amount is not arbitrarily prorated or turned into final per-seller invoice charge", () => {
  const row = fixture(); row.promo_discount_cents = 300; row.promo_code = "SYNTHETIC";
  const result = intake(row);
  assert.equal(result.observations.orderDiscountCents, 300);
  assert.equal(result.parts[0].deliveryCharge, null);
  assert.ok(result.money.some(value => value.scope === "marketplace_delivery" && value.grossCents === 774));
  assert.ok(result.issues.some(value => value.code === "DISCOUNT_ALLOCATION_UNRESOLVED"));
  assert.equal(result.billingAuthorized, false);
});

test("old missing fees, packaging, contacts, pickup and ambiguous temperature remain reviewable unknowns", () => {
  const row = fixture();
  row.delivery_info = {}; row.buyer_phone = null; delete row.items[0].storage_type;
  const result = intake(row, []);
  assert.equal(result.parts[0].pickup.kind, "unknown");
  assert.equal(result.parts[0].deliveryCharge, null);
  assert.equal(result.dropoff.kind, "unknown");
  assert.equal(result.temperature.mode, "unknown");
  assert.equal(result.parts[0].items[0].temperature.raw, "Synthetic category");
  for (const code of ["PACKAGING_UNRESOLVED", "TEMPERATURE_UNRESOLVED", "SCHEDULE_UNRESOLVED", "PICKUP_UNRESOLVED", "AMOUNT_UNRESOLVED"]) {
    assert.ok(result.issues.some(value => value.code === code), code);
  }
  assert.equal(result.money.find(value => value.scope === "marketplace_delivery").grossCents, null);
});

test("partial seller fee history and missing discount allocation remain reviewable, not fabricated", () => {
  const row = fixture();
  row.seller_ids.push(SELLER_B);
  row.items.push({ ...row.items[0], seller_id: SELLER_B, sellerId: SELLER_B, cart_item_id: "synthetic-cart-b" });
  row.delivery_info.delivery_fee_cents = 1074;
  delete row.promo_discount_cents;
  const result = intake(row);
  assert.equal(result.parts[0].deliveryCharge, null);
  assert.equal(result.parts[1].deliveryCharge, null);
  assert.equal(result.observations.orderDiscountCents, null);
  assert.ok(result.issues.some(entry => entry.code === "DISCOUNT_ALLOCATION_UNRESOLVED"));
  assert.ok(result.issues.some(entry => entry.code === "SELLER_DELIVERY_CHARGE_UNRESOLVED"));
  assert.equal(result.money.find(entry => entry.sellerId === SELLER_A && entry.scope === "marketplace_delivery").grossCents, 774);
});

test("ambiguous reordered item diagnostics and duplicate line IDs are deterministic", () => {
  const row = fixture();
  row.items.push({ ...row.items[0], variant_id: "variant-b", cart_item_id: "synthetic-cart-b" });
  delete row.items[0].storage_type; delete row.items[1].storage_type;
  const other = structuredClone(row); other.items.reverse();
  assert.deepEqual(adaptMarketplaceOrderV1(row), adaptMarketplaceOrderV1(other));
  row.items[1].cart_item_id = row.items[0].cart_item_id;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "DUPLICATE_ITEM_IDENTITY"));
});

test("known source locker alias and closed/unmapped lockers never authorize new work", () => {
  for (const [id, availability] of [["agenskalns", "known"], ["tukums", "closed_for_new_work"], ["unknown-test", "unmapped"]]) {
    const row = fixture(); row.delivery_type = "locker"; row.delivery_info.locker_id = id;
    const result = intake(row);
    assert.equal(result.dropoff.locker.code, id);
    assert.equal(result.dropoff.locker.availability, availability);
    assert.equal(result.dispatchAuthorized, false);
  }
});

test("duplicate/conflicting seller snapshots select no pickup; absent phone is not seller email", () => {
  const row = fixture();
  const result = intake(row, [snapshot(), { ...snapshot(), pickup: { ...snapshot().pickup, kind: "unknown" } }]);
  assert.equal(result.parts[0].pickup.kind, "unknown");
  assert.ok(result.issues.some(entry => entry.code === "DUPLICATE_SELLER_SNAPSHOT"));
  const missing = snapshot(); delete missing.pickup;
  assert.equal(intake(row, [missing]).parts[0].pickup.contact.phone, null);
});

test("source shipped/delivered and optional logistics false are never persisted courier/POD evidence", () => {
  for (const status of ["shipped", "delivered", "future-state"]) {
    const row = fixture(); row.status = status; row.logisticsRecorded = false;
    const result = intake(row);
    assert.equal(result.sourceStatus, status);
    assert.equal(result.dispatchAuthorized, false);
    assert.equal(result.payment.verified, false);
    assert.equal(Object.hasOwn(result, "logisticsRecorded"), false);
    assert.ok(result.issues.some(entry => entry.code === (status === "future-state" ? "SOURCE_STATUS_UNRECOGNIZED" : "FULFILLMENT_UNVERIFIED")));
  }
});

test("payment conflicts, unrecognized values and source-created timestamps require review", () => {
  const row = fixture(); row.payment_status = "awaiting"; row.created_at = "2026-02-30T12:00:00Z";
  row.delivery_info.delivery_date = "2026-02-30";
  const result = intake(row);
  assert.equal(result.sourceCreatedAt, null);
  assert.equal(result.schedule.date, null);
  assert.equal(result.payment.reportedStatus, "pending");
  assert.ok(result.issues.some(entry => entry.code === "PAYMENT_STATUS_CONFLICT"));
  row.payment_status = "unknown-provider-value";
  assert.equal(intake(row).payment.raw, "unknown-provider-value");
});

test("malformed records and full UUID truncation fail explicitly", () => {
  for (const value of [null, [], "order", 12]) assert.equal(adaptMarketplaceOrderV1(value).ok, false);
  for (const id of ["11111111", `${ORDER}trailing`, "../unsafe", ""]) {
    const row = fixture(); row.id = id;
    assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "INVALID_SOURCE_IDENTITY"));
  }
  const row = fixture(); row.buyer_id = "44444444";
  assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "INVALID_BUYER_ID"));
});

test("aggregate/item seller and item alias conflicts are blocking, not first-seller selection", () => {
  const row = fixture(); row.items[0].sellerId = SELLER_B;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "SELLER_OWNERSHIP_CONFLICT"));
  row.items[0].seller_id = SELLER_B;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "SELLER_AGGREGATE_CONFLICT"));
  const listing = fixture(); listing.items[0].listing_id = ORDER;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(listing), "LISTING_ID_CONFLICT"));
});

test("integer cents reject strings, negatives, NaN, unsafe values and unexpected currency", () => {
  for (const value of ["2774", -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const row = fixture(); row.total_cents = value;
    assert.equal(adaptMarketplaceOrderV1(row).ok, false);
  }
  for (const currency of ["USD", "", 978]) {
    const row = fixture(); row.currency = currency;
    assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "INVALID_MONEY"));
  }
});

test("goods precision/quantity and multiplication overflow are never silently rounded", () => {
  for (const price of [1.005, "1.005", -1, NaN, Infinity, "1,00"]) {
    const row = fixture(); row.items[0].price = price;
    assert.equal(adaptMarketplaceOrderV1(row).ok, false);
  }
  for (const quantity of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
    const row = fixture(); row.items[0].quantity = quantity;
    assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "INVALID_QUANTITY"));
  }
  const row = fixture(); row.items[0].quantity = Number.MAX_SAFE_INTEGER;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(row), "UNSAFE_LINE_TOTAL"));
});

test("per-seller alias/tax/aggregate money inconsistencies are explicit failures", () => {
  const aliases = fixture(); aliases.delivery_info.delivery_fees_by_seller[0].feeCents = 775;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(aliases), "DELIVERY_FEE_CONFLICT"));
  const taxes = fixture(); taxes.delivery_info.delivery_fees_by_seller[0].vatCents = 1;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(taxes), "INVALID_DELIVERY_FEE_MONEY"));
  const sum = fixture(); sum.delivery_info.delivery_fee_cents = 775;
  assert.ok(hasIssue(adaptMarketplaceOrderV1(sum), "DELIVERY_TOTAL_CONFLICT"));
  const duplicate = fixture(); duplicate.delivery_info.delivery_fees_by_seller.push({ ...duplicate.delivery_info.delivery_fees_by_seller[0] });
  assert.ok(hasIssue(adaptMarketplaceOrderV1(duplicate), "DELIVERY_FEE_OWNERSHIP_CONFLICT"));
});

test("unknown input fields and forged administrative/verification flags are not copied", () => {
  const row = fixture();
  Object.assign(row, { dispatchAuthorized: true, billingAuthorized: true, admin: true, internalKey: "never-project" });
  row.payment = { verified: true, secret: "never-project" };
  row.delivery_info.internalKey = "never-project";
  row.items[0].internalKey = "never-project";
  const sender = snapshot(); sender.pickup.internalKey = "never-project";
  const result = intake(row, [sender]);
  assert.equal(JSON.stringify(result).includes("never-project"), false);
  assert.equal(Object.hasOwn(result, "admin"), false);
  assert.equal(result.payment.verified, false);
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.billingAuthorized, false);
});
