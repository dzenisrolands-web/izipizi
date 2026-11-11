import type {
  Contact, Endpoint, FulfillmentPart, IntakeResult, MarketplaceSellerSnapshot,
  MoneyObservation, ReviewIssue, SourceItem, Temperature,
} from "../contract.ts";
import {
  createIntake, emptyContact, invalid, isRecord, isUuid, issue, lockerReference,
  observedMoney, parseEuroCents, parseIntegerCents, sourceReference, text,
  unknownEndpoint, unknownTemperature,
} from "../core.ts";

const SCHEMA = "marketplace-order-v1" as const;
const ORDER_STATUSES = new Set(["pending", "paid", "processing", "shipped", "delivered", "cancelled"]);
const PAYMENT_STATUSES = new Set(["awaiting", "pending", "paid", "refunded", "cancelled", "failed"]);
type Row = Record<string, unknown>;
type OwnedItem = { sellerId: string | null; item: SourceItem; goods: MoneyObservation | null };

function contact(row: Row, prefix = ""): Contact {
  const phone = text(row[`${prefix}phone`], 100);
  return {
    name: text(row[`${prefix}name`], 200),
    phone: phone?.includes("@") ? null : phone,
    email: text(row[`${prefix}email`], 320),
  };
}

function timestamp(value: unknown): string | null {
  const valueText = text(value, 100);
  return valueText && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(valueText)
    && date(valueText.slice(0, 10)) && Number.isFinite(Date.parse(valueText)) ? valueText : null;
}

function date(value: unknown): string | null {
  const valueText = text(value, 10);
  if (!valueText || !/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
  const parsed = new Date(`${valueText}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === valueText ? valueText : null;
}

function sourceTemperature(row: Row, issues: ReviewIssue[], path: string): Temperature {
  const storage = text(row.storage_type, 100);
  if (storage === "chilled" || storage === "frozen") {
    return { mode: storage, basis: "explicit_source", raw: storage };
  }
  issues.push(issue("TEMPERATURE_UNRESOLVED", `${path}.storage_type`,
    "Source does not explicitly identify chilled or frozen handling; category is not temperature proof."));
  return unknownTemperature(storage ?? text(row.category, 200));
}

function combinedTemperature(items: readonly SourceItem[], issues: ReviewIssue[], path: string): Temperature {
  const modes = new Set(items.map(item => item.temperature.mode));
  if (!modes.size || modes.has("unknown")) {
    issues.push(issue("TEMPERATURE_UNRESOLVED", path, "Temperature requirements need source clarification."));
    return unknownTemperature();
  }
  return { mode: modes.size > 1 ? "dual" : items[0].temperature.mode, basis: "explicit_source", raw: null };
}

function snapshotPickup(snapshot: Row | undefined, issues: ReviewIssue[], path: string): Endpoint {
  if (!snapshot || !isRecord(snapshot.pickup)) {
    issues.push(issue("PICKUP_UNRESOLVED", path, "An explicit seller pickup snapshot is required."));
    return unknownEndpoint(snapshot ? contact(snapshot) : emptyContact());
  }
  const pickup = snapshot.pickup as unknown as Row;
  const sourceContact = isRecord(pickup.contact) ? pickup.contact : {};
  const recipient = contact(sourceContact);
  if (!recipient.phone) issues.push(issue("SENDER_PHONE_UNRESOLVED", `${path}.contact.phone`, "Sender phone is not recorded."));
  if (pickup.kind === "address" && isRecord(pickup.address)) {
    const address = pickup.address;
    const raw = text(address.raw);
    const street = text(address.street);
    if (raw || street) return {
      kind: "address", contact: recipient, locker: null,
      address: {
        raw, street, city: text(address.city, 200), postalCode: text(address.postalCode, 30),
        apartment: text(address.apartment, 100), floor: text(address.floor, 100), entryCode: text(address.entryCode, 100),
      },
    };
  }
  if (pickup.kind === "locker" && isRecord(pickup.locker)) {
    const namespace = text(pickup.locker.namespace, 100);
    const locker = namespace ? lockerReference(namespace, pickup.locker.code) : null;
    if (locker) {
      if (locker.availability !== "known") issues.push(issue("PICKUP_LOCKER_REVIEW", `${path}.locker`,
        "Pickup locker is closed or outside the known source namespace."));
      return { kind: "locker", contact: recipient, address: null, locker: { ...locker, label: text(pickup.locker.label, 500) } };
    }
  }
  issues.push(issue("PICKUP_UNRESOLVED", path, "Pickup snapshot does not contain an explicit usable endpoint."));
  return unknownEndpoint(recipient);
}

function dropoff(row: Row, info: Row, method: string, issues: ReviewIssue[]): Endpoint {
  const recipient = contact(row, "buyer_");
  if (!recipient.name || !recipient.phone) issues.push(issue("RECIPIENT_CONTACT_INCOMPLETE", "buyer",
    "Recipient name and phone need source clarification."));
  if (method === "locker") {
    const locker = lockerReference(SCHEMA, info.locker_id);
    if (locker) {
      if (locker.availability !== "known") issues.push(issue("DROPOFF_LOCKER_REVIEW", "delivery_info.locker_id",
        "Destination locker is closed or unmapped."));
      return { kind: "locker", contact: recipient, address: null, locker };
    }
  } else if (method === "courier" || method === "express") {
    const street = text(info.address);
    const city = text(info.city, 200);
    if (street) {
      if (!city || !text(info.postal_code, 30)) issues.push(issue("ADDRESS_INCOMPLETE", "delivery_info",
        "Destination city or postal code is missing."));
      return {
        kind: "address", contact: recipient, locker: null,
        address: {
          raw: text(info.address_search) ?? street, street, city, postalCode: text(info.postal_code, 30),
          apartment: text(info.apartment, 100), floor: text(info.floor, 100), entryCode: text(info.entry_code, 100),
        },
      };
    }
  }
  issues.push(issue("DROPOFF_UNRESOLVED", "delivery_info", "Delivery method or destination is not explicit."));
  return unknownEndpoint(recipient);
}

function checkCurrency(row: Row): void {
  for (const field of ["currency", "currency_code"]) {
    if (row[field] != null && row[field] !== "EUR") throw new TypeError("Unsupported currency");
  }
}

function moneyAt(
  scope: MoneyObservation["scope"], value: unknown, path: string,
  issues: ReviewIssue[], euro = false,
): MoneyObservation {
  const gross = euro ? parseEuroCents(value) : parseIntegerCents(value);
  if (gross === null) issues.push(issue("AMOUNT_UNRESOLVED", path, "Source amount is not recorded."));
  return { ...observedMoney(scope, gross), sourcePath: path };
}

/** Pure projection of source observations; this does not verify payments or create courier work. */
export function adaptMarketplaceOrderV1(
  record: unknown, sellerSnapshots: readonly MarketplaceSellerSnapshot[] = [],
): IntakeResult {
  if (!isRecord(record)) return invalid(SCHEMA, "INVALID_RECORD", "", "An order object is required.");
  let source;
  try { source = sourceReference(SCHEMA, record.id, record.order_number); }
  catch { return invalid(SCHEMA, "INVALID_SOURCE_IDENTITY", "id", "A full order UUID and valid human reference are required."); }
  const issues: ReviewIssue[] = [];
  const bad = (code: string, path: string, message: string) => issues.push(issue(code, path, message, "blocking"));
  if (!source.reference) issues.push(issue("ORDER_REFERENCE_UNRESOLVED", "order_number", "Human order reference is missing."));
  const info = isRecord(record.delivery_info) ? record.delivery_info : {};
  if (!isRecord(record.delivery_info)) issues.push(issue("DELIVERY_INFO_UNRESOLVED", "delivery_info", "Delivery metadata is missing."));
  const sourceStatus = text(record.status, 100);
  if (!sourceStatus || !ORDER_STATUSES.has(sourceStatus)) issues.push(issue("SOURCE_STATUS_UNRECOGNIZED", "status", "Source lifecycle status needs review."));
  const rawPayment = text(record.payment_status, 100);
  if (!rawPayment || !PAYMENT_STATUSES.has(rawPayment)) issues.push(issue("PAYMENT_STATUS_UNRECOGNIZED", "payment_status", "Payment status is an unverified source observation."));
  if (["paid", "processing", "shipped", "delivered"].includes(sourceStatus ?? "") && rawPayment !== "paid") {
    issues.push(issue("PAYMENT_STATUS_CONFLICT", "payment_status", "Order lifecycle and payment observations disagree."));
  }
  if (["shipped", "delivered"].includes(sourceStatus ?? "")) issues.push(issue("FULFILLMENT_UNVERIFIED", "status",
    "Source status is not evidence of a persisted courier job or proof of delivery."));
  const methodText = text(record.delivery_type, 100);
  const method = methodText === "locker" || methodText === "courier" || methodText === "express" ? methodText : "unknown";
  if (method === "unknown") issues.push(issue("METHOD_UNRESOLVED", "delivery_type", "Delivery method is not recognized."));
  const createdAt = timestamp(record.created_at);
  if (!createdAt) issues.push(issue("CREATED_AT_UNRESOLVED", "created_at", "A source creation timestamp is not recorded or valid."));
  const scheduleDate = date(info.delivery_date);
  const scheduleWindow = text(info.time_slot, 200);
  if (!scheduleDate || !scheduleWindow) issues.push(issue("SCHEDULE_UNRESOLVED", "delivery_info",
    "Delivery date or source window is missing; no timezone or deadline is inferred."));
  const clientId = record.buyer_id == null ? null : isUuid(record.buyer_id) ? record.buyer_id : null;
  if (record.buyer_id != null && !clientId) bad("INVALID_BUYER_ID", "buyer_id", "Recorded buyer identity must be a full UUID.");
  const aggregateIds = new Set<string>();
  if (record.seller_ids != null && !Array.isArray(record.seller_ids)) bad("INVALID_SELLER_IDS", "seller_ids", "Seller aggregate must be an array.");
  for (const id of Array.isArray(record.seller_ids) ? record.seller_ids : []) {
    if (!isUuid(id)) bad("INVALID_SELLER_ID", "seller_ids", "Seller identity must be a full UUID.");
    else if (aggregateIds.has(id)) issues.push(issue("DUPLICATE_SELLER_ID", "seller_ids", "Source seller aggregate has duplicates."));
    else aggregateIds.add(id);
  }
  const owned: OwnedItem[] = [];
  const money: MoneyObservation[] = [];
  let discount: number | null = null;
  try {
    checkCurrency(record); checkCurrency(info);
    money.push({ ...moneyAt("marketplace_order_total", record.total_cents, "total_cents", issues),
      discountTreatment: "after_recorded_discount" });
    if (record.total_amount != null && parseEuroCents(record.total_amount) !== parseIntegerCents(record.total_cents)) {
      bad("ORDER_TOTAL_CONFLICT", "total_amount", "Euro and integer-cent order totals disagree.");
    }
    discount = parseIntegerCents(record.promo_discount_cents ?? info.promo_discount_cents);
    if (record.promo_discount_cents != null && info.promo_discount_cents != null &&
        parseIntegerCents(record.promo_discount_cents) !== parseIntegerCents(info.promo_discount_cents)) {
      bad("DISCOUNT_CONFLICT", "promo_discount_cents", "Order and delivery discount observations disagree.");
    }
    money.push({
      ...moneyAt("marketplace_delivery", info.delivery_fee_cents, "delivery_info.delivery_fee_cents", issues),
      tariffVersion: text(info.tariff_version, 200), zonePolicy: text(info.zone_policy, 200),
      discountTreatment: "before_order_discount",
    });
    if (!Array.isArray(record.items) || !record.items.length) issues.push(issue("ITEMS_UNRESOLVED", "items", "No source items are recorded."));
    const rawItems = Array.isArray(record.items) ? record.items : [];
    const itemIdentities = new Set<string>();
    for (let index = 0; index < rawItems.length; index++) {
      const raw = rawItems[index];
      const identity = isRecord(raw) ? text(raw.cart_item_id, 200)
        ?? `${text(raw.listing_id ?? raw.id, 200) ?? "unresolved"}/${text(raw.variant_id, 200) ?? ""}` : "unresolved";
      const path = `items/${encodeURIComponent(identity)}`;
      if (!isRecord(raw)) { bad("INVALID_ITEM", path, "Item must be an object."); continue; }
      if (itemIdentities.has(identity)) bad("DUPLICATE_ITEM_IDENTITY", path, "Repeated source line identity needs reconciliation.");
      itemIdentities.add(identity);
      checkCurrency(raw);
      const owner = raw.seller_id ?? raw.sellerId;
      if (raw.seller_id != null && raw.sellerId != null && raw.seller_id !== raw.sellerId) {
        bad("SELLER_OWNERSHIP_CONFLICT", path, "Item seller identities disagree.");
      }
      const sellerId = isUuid(owner) ? owner : null;
      if (!sellerId) issues.push(issue("ITEM_SELLER_UNRESOLVED", path, "Item seller is not a recorded full UUID."));
      const listingId = text(raw.listing_id ?? raw.id, 200);
      if (raw.listing_id != null && raw.id != null && raw.listing_id !== raw.id) {
        bad("LISTING_ID_CONFLICT", path, "Stored listing identities disagree.");
      }
      if (!listingId) issues.push(issue("LISTING_ID_UNRESOLVED", path, "Item listing identity is missing."));
      const quantity = typeof raw.quantity === "number" && Number.isSafeInteger(raw.quantity) && raw.quantity > 0 ? raw.quantity : null;
      if (quantity === null) bad("INVALID_QUANTITY", `${path}.quantity`, "Quantity must be a positive safe integer.");
      const unit = parseEuroCents(raw.price);
      if (unit === null) issues.push(issue("AMOUNT_UNRESOLVED", `${path}.price`, "Source goods unit amount is missing."));
      const line = unit !== null && quantity !== null ? unit * quantity : null;
      if (line !== null && !Number.isSafeInteger(line)) bad("UNSAFE_LINE_TOTAL", path, "Goods amount exceeds safe integer cents.");
      const item: SourceItem = {
        listingId, variantId: text(raw.variant_id, 200), cartItemId: text(raw.cart_item_id, 200),
        title: text(raw.title, 500), quantity, unitGrossCents: unit,
        temperature: sourceTemperature(raw, issues, path),
      };
      owned.push({
        sellerId, item,
        goods: line !== null && Number.isSafeInteger(line)
          ? { ...observedMoney("marketplace_goods", line), sellerId, discountTreatment: "before_order_discount",
            sourcePath: `seller/${sellerId ?? "unresolved"}/item/${encodeURIComponent(item.cartItemId ?? `${listingId ?? "unresolved"}/${item.variantId ?? ""}`)}` }
          : null,
      });
    }
  } catch {
    bad("INVALID_MONEY", "money", "Source currency or money is invalid, negative, unsafe or has excess decimal precision.");
  }
  const itemSellerIds = new Set(owned.map(entry => entry.sellerId).filter((id): id is string => id !== null));
  if (Array.isArray(record.seller_ids) && (aggregateIds.size !== itemSellerIds.size ||
      [...aggregateIds].some(id => !itemSellerIds.has(id)))) {
    bad("SELLER_AGGREGATE_CONFLICT", "seller_ids", "Seller aggregate and item ownership differ.");
  }
  if (!aggregateIds.size) issues.push(issue("SELLER_AGGREGATE_UNRESOLVED", "seller_ids", "Source seller aggregate is missing."));
  const sellerIds = [...new Set([...aggregateIds, ...itemSellerIds])].sort();
  const snapshots = new Map<string, Row>();
  const duplicateSnapshots = new Set<string>();
  if (!Array.isArray(sellerSnapshots)) return invalid(SCHEMA, "INVALID_SELLER_SNAPSHOTS", "sellerSnapshots", "Seller snapshots must be an array.");
  for (const snapshot of sellerSnapshots) {
    if (!isRecord(snapshot) || !isUuid(snapshot.sellerId)) {
      bad("INVALID_SELLER_SNAPSHOT", "sellerSnapshots", "Snapshot seller must have a full UUID."); continue;
    }
    if (snapshots.has(snapshot.sellerId)) {
      duplicateSnapshots.add(snapshot.sellerId);
      issues.push(issue("DUPLICATE_SELLER_SNAPSHOT", `sellerSnapshots/${snapshot.sellerId}`, "Duplicate snapshots require review; no pickup is selected."));
    } else snapshots.set(snapshot.sellerId, snapshot);
    if (!sellerIds.includes(snapshot.sellerId)) issues.push(issue("UNRELATED_SELLER_SNAPSHOT", `sellerSnapshots/${snapshot.sellerId}`,
      "Snapshot is unrelated to recorded order sellers."));
  }
  const fees = new Map<string, MoneyObservation>();
  if (info.delivery_fees_by_seller != null && !Array.isArray(info.delivery_fees_by_seller)) {
    bad("INVALID_DELIVERY_FEES", "delivery_info.delivery_fees_by_seller", "Delivery fees must be an array.");
  }
  for (const fee of Array.isArray(info.delivery_fees_by_seller) ? info.delivery_fees_by_seller : []) {
    if (!isRecord(fee) || !isUuid(fee.sellerId)) {
      bad("INVALID_DELIVERY_FEE", "delivery_info.delivery_fees_by_seller", "Fee seller identity is invalid."); continue;
    }
    const path = `delivery_info.delivery_fees_by_seller/${fee.sellerId}`;
    if (!sellerIds.includes(fee.sellerId) || fees.has(fee.sellerId)) {
      bad("DELIVERY_FEE_OWNERSHIP_CONFLICT", path, "Duplicate or unrelated seller delivery fee."); continue;
    }
    try {
      checkCurrency(fee);
      const total = parseIntegerCents(fee.totalCents ?? fee.feeCents);
      if (fee.totalCents != null && fee.feeCents != null && total !== parseIntegerCents(fee.feeCents)) {
        bad("DELIVERY_FEE_CONFLICT", path, "Fee aliases disagree."); continue;
      }
      const observation: MoneyObservation = { ...observedMoney("marketplace_delivery", total,
        parseIntegerCents(fee.netCents), parseIntegerCents(fee.vatCents)), sourcePath: path,
        sellerId: fee.sellerId, tariffVersion: text(fee.tariffVersion, 200) ?? text(info.tariff_version, 200),
        zonePolicy: text(fee.zonePolicy, 200) ?? text(info.zone_policy, 200), discountTreatment: "before_order_discount" };
      if (total === null) issues.push(issue("AMOUNT_UNRESOLVED", path, "Seller delivery charge is not recorded."));
      if (fee.method != null && fee.method !== method) issues.push(issue("DELIVERY_FEE_CONTEXT_CONFLICT", path,
        "Source fee method and order method differ; no tariff is recomputed."));
      if (fee.lockerId != null && fee.lockerId !== info.locker_id) issues.push(issue("DELIVERY_FEE_CONTEXT_CONFLICT", path,
        "Source fee destination and order destination differ."));
      fees.set(fee.sellerId, observation);
    } catch { bad("INVALID_DELIVERY_FEE_MONEY", path, "Seller fee currency or amounts are invalid or inconsistent."); }
  }
  if (fees.size && [...fees.values()].every(fee => fee.grossCents !== null)) {
    const sum = [...fees.values()].reduce((total, fee) => total + fee.grossCents!, 0);
    if (!Number.isSafeInteger(sum)) bad("UNSAFE_DELIVERY_TOTAL", "delivery_info.delivery_fees_by_seller",
      "Combined seller fees exceed safe integer cents.");
    else if (fees.size === sellerIds.length && info.delivery_fee_cents != null && sum !== info.delivery_fee_cents) {
      bad("DELIVERY_TOTAL_CONFLICT", "delivery_info.delivery_fee_cents", "Seller delivery fees and aggregate disagree.");
    }
  }
  const discountUnallocated = discount === null || discount > 0 || !!text(record.promo_code ?? info.promo_code, 200);
  if (discountUnallocated) issues.push(issue("DISCOUNT_ALLOCATION_UNRESOLVED", "promo_discount_cents",
    "Order promo is observed without an approved per-seller allocation; source charges are not final invoices."));
  const confirmations = isRecord(record.seller_confirmations) ? record.seller_confirmations : {};
  if (record.seller_confirmations != null && !isRecord(record.seller_confirmations)) {
    issues.push(issue("SELLER_CONFIRMATIONS_UNRESOLVED", "seller_confirmations", "Source confirmations must be a seller-keyed map."));
  }
  const groups: (string | null)[] = [...sellerIds, ...(owned.some(entry => entry.sellerId === null) ? [null] : [])];
  const parts: FulfillmentPart[] = groups.map(sellerId => {
    const entries = owned.filter(entry => entry.sellerId === sellerId)
      .sort((a, b) => JSON.stringify(a.item) < JSON.stringify(b.item) ? -1 : JSON.stringify(a.item) > JSON.stringify(b.item) ? 1 : 0);
    const items = entries.map(entry => entry.item);
    for (const entry of entries) if (entry.goods) money.push(entry.goods);
    const path = `parts/${sellerId ?? "unresolved"}`;
    const fee = sellerId ? fees.get(sellerId) ?? null : null;
    if (fee) money.push(fee);
    else issues.push(issue("SELLER_DELIVERY_CHARGE_UNRESOLVED", path, "Seller delivery charge needs source clarification."));
    const rawConfirmation = sellerId && isRecord(confirmations[sellerId]) ? confirmations[sellerId] : null;
    const confirmedAt = rawConfirmation ? timestamp(rawConfirmation.confirmed_at) : null;
    if (rawConfirmation && !confirmedAt) issues.push(issue("CONFIRMATION_TIMESTAMP_UNRESOLVED", path, "Seller confirmation timestamp is not valid."));
    return {
      key: `${source.key}/seller/${sellerId ?? "unresolved"}`, sellerId,
      pickup: snapshotPickup(sellerId && !duplicateSnapshots.has(sellerId) ? snapshots.get(sellerId) : undefined, issues, `${path}/pickup`),
      items, temperature: combinedTemperature(items, issues, `${path}/temperature`),
      deliveryCharge: discountUnallocated ? null : fee,
      senderConfirmation: rawConfirmation ? { recordedAt: confirmedAt, verification: "unverified_source" } : null,
    };
  });
  const destination = dropoff(record, info, method, issues);
  const temperature = combinedTemperature(owned.map(entry => entry.item), issues, "temperature");
  const sizeCode = text(record.size, 20);
  const weightKg = typeof record.weight_kg === "number" && Number.isFinite(record.weight_kg) && record.weight_kg > 0 ? record.weight_kg : null;
  if (!sizeCode && weightKg === null) issues.push(issue("PACKAGING_UNRESOLVED", "packaging", "Packaging size and weight are not recorded."));
  if (record.weight_kg != null && weightKg === null) bad("INVALID_WEIGHT", "weight_kg", "Recorded weight must be positive and finite.");
  if (sizeCode && !["M", "L", "XL"].includes(sizeCode)) issues.push(issue("PACKAGING_SIZE_UNRECOGNIZED", "size", "Source packaging code needs review."));
  issues.sort((a, b) => {
    const left = `${a.path}/${a.code}/${a.message}`;
    const right = `${b.path}/${b.code}/${b.message}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (issues.some(entry => entry.severity === "blocking")) return { ok: false, schema: SCHEMA, issues };
  return {
    ok: true,
    intake: createIntake({
      source, sourceStatus, sourceCreatedAt: createdAt, method,
      notes: text(info.note), contactEmail: text(record.buyer_email, 320),
      client: clientId ? { namespace: "supabase_auth", id: clientId, verification: "source_observation" } : null,
      pickup: unknownEndpoint(), dropoff: destination, temperature,
      packaging: { sizeCode, weightKg },
      schedule: { date: scheduleDate, window: scheduleWindow, timezone: null },
      money, payment: {
        reportedStatus: rawPayment === "paid" ? "paid" : rawPayment === "refunded" ? "refunded"
          : rawPayment === "pending" || rawPayment === "awaiting" ? "pending" : "unknown",
        raw: rawPayment, verified: false, provider: text(record.payment_provider, 100),
        sessionReference: text(record.payment_session_id, 200),
      },
      observations: { orderDiscountCents: discount }, parts, issues,
    }),
  };
}
