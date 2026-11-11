import type { CanonicalIntake, Contact, Endpoint, IntakeResult, MoneyObservation, ReviewIssue, SourceSchema, Temperature } from "../contract.ts";
import { createIntake, invalid, isRecord, isUuid, issue, lockerReference, observedMoney, parseEuroCents, sourceReference, text, unknownEndpoint, unknownTemperature } from "../core.ts";

/** Shared adapter readers never access infrastructure or change source data. */
export function alias(row: Record<string, unknown>, snake: string, camel: string): unknown {
  if (Object.hasOwn(row, snake) && Object.hasOwn(row, camel) && row[snake] !== row[camel]) {
    throw new TypeError(`Conflicting aliases: ${snake}`);
  }
  return Object.hasOwn(row, snake) ? row[snake] : row[camel];
}

export function optionalText(value: unknown): string | null {
  if (value == null || value === "") return null;
  const result = text(value);
  if (!result) throw new TypeError("Malformed text");
  return result;
}

export function sourceTime(value: unknown, issues: ReviewIssue[]): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isFinite(value.getTime())) return value.toISOString();
    issues.push(issue("invalid_source_timestamp", "created_at", "Source timestamp cannot be established."));
    return null;
  }
  const stamp = optionalText(value);
  const date = stamp?.slice(0, 10);
  if (!stamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ||
      !Number.isFinite(Date.parse(stamp)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    issues.push(issue("invalid_source_timestamp", "created_at", "Source timestamp cannot be established."));
    return null;
  }
  return stamp;
}

export function moneyObservation(
  scope: "legacy_logistics" | "website_logistics", gross: unknown, net: unknown,
  vatRate: unknown, issues: ReviewIssue[],
): MoneyObservation {
  const grossCents = parseEuroCents(gross), netCents = parseEuroCents(net);
  if (vatRate != null && !(typeof vatRate === "number" && Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 1) &&
      !(typeof vatRate === "string" && vatRate.length <= 32 && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(vatRate))) {
    throw new TypeError("Malformed VAT rate");
  }
  const contradictory = grossCents !== null && netCents !== null && netCents > grossCents;
  if (contradictory) throw new TypeError("Net exceeds gross");
  const vatCents = grossCents !== null && netCents !== null ? grossCents - netCents : null;
  if (vatRate != null && netCents !== null && grossCents !== null &&
      Math.abs(Math.round(netCents * (1 + Number(vatRate))) - grossCents) > 1) {
    issues.push(issue("source_vat_conflict", "money", "Source net, gross and VAT rate disagree; no amount was repaired."));
  }
  if (grossCents === null) issues.push(issue("price_unresolved", "money.grossCents", "Missing price is not a free delivery."));
  return {
    ...observedMoney(scope, grossCents, netCents, vatCents),
    rawGross: gross == null ? null : gross as string | number,
    rawNet: net == null ? null : net as string | number,
  };
}

export function statusObservation(value: unknown, known: readonly string[], issues: ReviewIssue[]): {
  status: string | null; payment: CanonicalIntake["payment"];
} {
  const status = optionalText(value);
  if (!status || !known.includes(status)) issues.push(issue("unknown_source_status", "status", "Source status is missing or unrecognized."));
  const reportedStatus = status === "paid" || status === "apmaksats" ? "paid"
    : status === "gaida_apmaksu" ? "pending" : "unknown";
  if (reportedStatus === "paid") issues.push(issue("unverified_payment_claim", "status", "Source paid status is not independent payment verification."));
  return { status, payment: { reportedStatus, raw: status, verified: false } };
}

export function lockerEndpoint(schema: SourceSchema, code: unknown, contact: Contact, issues: ReviewIssue[], path: string): Endpoint {
  const locker = lockerReference(schema, code);
  if (!locker) {
    issues.push(issue("missing_locker", path, "Locker reference is missing.", "blocking"));
    return unknownEndpoint(contact);
  }
  if (locker.availability !== "known") issues.push(issue(
    locker.availability === "closed_for_new_work" ? "locker_closed" : "locker_unmapped", path,
    locker.availability === "closed_for_new_work" ? "Historical locker is closed for new work." : "Locker namespace has no verified mapping.",
    locker.availability === "closed_for_new_work" ? "blocking" : "review",
  ));
  return { kind: "locker", contact, address: null, locker };
}

export function addressEndpoint(raw: unknown, city: unknown, postalCode: unknown, contact: Contact, issues: ReviewIssue[], path: string): Endpoint {
  const address = optionalText(raw), cityText = optionalText(city), postal = optionalText(postalCode);
  if (!address) issues.push(issue("missing_address", path, "Source address is missing.", "blocking"));
  return { kind: "address", contact, locker: null,
    address: { raw: typeof raw === "string" && address ? raw : null, street: address, city: cityText, postalCode: postal } };
}

export function nonnegativeNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError("Malformed numeric observation");
  return value;
}

function contact(row: Record<string, unknown>, prefix: string): Contact {
  return { name: optionalText(row[`${prefix}_name`]), phone: optionalText(row[`${prefix}_phone`]), email: optionalText(row[`${prefix}_email`]) };
}

function temperatureV2(value: unknown, issues: ReviewIssue[]): Temperature {
  const raw = optionalText(value);
  const modes: Record<string, Temperature["mode"]> = {
    none: "ambient", chilled: "chilled", frozen: "frozen", both: "dual",
    "+2...+6 °C": "chilled", "+2…+6 °C": "chilled", "−18 °C": "frozen", "-18 °C": "frozen",
  };
  if (raw && Object.hasOwn(modes, raw)) return { mode: modes[raw], basis: "explicit_source", raw };
  issues.push(issue("unknown_temperature", "temp_mode", "Temperature is not established by the source."));
  return unknownTemperature(raw);
}

function legacy(record: unknown, schema: "legacy-form-v1" | "legacy-label-v2"): IntakeResult {
  if (!isRecord(record)) return invalid(schema, "invalid_record", "", "Expected a source record.");
  try {
    const row = record, issues: ReviewIssue[] = [], v1 = schema === "legacy-form-v1";
    const incompatible = v1
      ? ["delivery_type", "from_locker", "to_locker", "from_locker_name", "to_locker_name", "price_total", "courier_address", "courier_zip", "temp_mode", "same_locker"]
      : ["method", "locker_from", "locker_to", "price_eur", "price_excl_vat", "temp_tier", "locker_same"];
    if (incompatible.some((key) => Object.hasOwn(row, key))) return invalid(schema, "mixed_source_schema", "", "Explicit legacy source versions must not be mixed.");
    const ref = optionalText(row.ref);
    if (row.id != null && !isUuid(row.id)) return invalid(schema, "invalid_source_id", "id", "Persisted identity requires a full UUID.");
    if (!row.id && (!v1 || !ref)) return invalid(schema, "missing_source_id", "id", "A full UUID or explicit v1 browser reference is required.");
    const source = sourceReference(schema, row.id ?? ref, ref, row.id ? "persisted_id" : "reference_only");
    if (!row.id) issues.push(issue("reference_only_identity", "ref", "Browser reference does not prove database persistence."));
    const rawMethod = optionalText(row[v1 ? "method" : "delivery_type"]);
    if (!rawMethod || !(v1 ? ["locker", "courier", "bus"] : ["locker", "courier"]).includes(rawMethod)) {
      return invalid(schema, "invalid_method", v1 ? "method" : "delivery_type", "Unsupported or missing source method.");
    }
    const method = rawMethod as "locker" | "courier" | "bus";
    const sender = contact(row, "sender"), recipient = contact(row, "recipient");
    const pickup = method === "locker"
      ? lockerEndpoint(schema, row[v1 ? "locker_from" : "from_locker"], sender, issues, "pickup")
      : v1 ? addressEndpoint(row.sender_address, null, null, sender, issues, "pickup")
        : unknownEndpoint(sender);
    const dropoff = method === "locker"
      ? lockerEndpoint(schema, row[v1 ? "locker_to" : "to_locker"], recipient, issues, "dropoff")
      : addressEndpoint(row[v1 ? "recipient_address" : "courier_address"], null, row[v1 ? "recipient_zip" : "courier_zip"], recipient, issues, "dropoff");
    if (!v1 && method === "courier") issues.push(issue("missing_pickup", "pickup", "Label schema does not establish a collection address.", "blocking"));
    const size = optionalText(row.size);
    let temperature: Temperature;
    if (!v1) temperature = temperatureV2(row.temp_mode, issues);
    else if (method === "locker") {
      const mode = size === "L" ? "frozen" : size === "M" || size === "XL" ? "chilled" : null;
      if (!mode) return invalid(schema, "invalid_size", "size", "Form locker size must be M, L or XL.");
      temperature = { mode, basis: "source_size_rule", raw: size };
    } else {
      const tier = row.temp_tier;
      if (tier !== 0 && tier !== 1 && tier !== 2) return invalid(schema, "invalid_temperature_tier", "temp_tier", "Expected the source numeric temperature tier.");
      temperature = { mode: tier === 0 ? "ambient" : tier === 1 ? "cold_unspecified" : "dual", basis: "explicit_source", raw: tier };
      if (tier === 1) issues.push(issue("ambiguous_cold_temperature", "temp_tier", "Single cold tier does not identify chilled versus frozen."));
    }
    const vatRate = v1 ? row.vat_rate : null;
    const money = moneyObservation("legacy_logistics", row[v1 ? "price_eur" : "price_total"], v1 ? row.price_excl_vat : null, vatRate, issues);
    const status = statusObservation(row.status, v1 ? ["jauns", "cenas_pieprasijums", "apmaksats", "gaida_apmaksu"] : ["new", "confirmed", "paid", "delivered", "cancelled"], issues);
    const details = row.details == null ? {} : row.details;
    if (!isRecord(details)) throw new TypeError("Malformed details");
    if (pickup.locker) pickup.locker.label = optionalText(v1 ? details.from_name : row.from_locker_name);
    if (dropoff.locker) dropoff.locker.label = optionalText(v1 ? details.to_name : row.to_locker_name);
    money.sourcePath = v1 ? "price_eur" : "price_total";
    const date = optionalText(row.delivery_date);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new TypeError("Malformed delivery date");
    const same = row[v1 ? "locker_same" : "same_locker"];
    if (same != null && typeof same !== "boolean") throw new TypeError("Malformed same-locker observation");
    const zone = row.zone;
    if (zone != null && (typeof zone !== "number" || !Number.isInteger(zone) || zone < 0 || zone > 4)) throw new TypeError("Malformed zone");
    const weightUnits = nonnegativeNumber(row.weight_units);
    if (weightUnits !== null && (!Number.isSafeInteger(weightUnits) || weightUnits < 1)) throw new TypeError("Malformed weight units");
    const speed = optionalText(row.speed);
    if (speed && speed !== "standard" && speed !== "express") issues.push(issue("unknown_source_speed", "speed", "Source delivery speed is unrecognized."));
    return { ok: true, intake: createIntake({
      source, sourceStatus: status.status, sourceCreatedAt: sourceTime(row.created_at, issues), method, client: null,
      description: v1 ? optionalText(row.cargo) : null, notes: v1 ? null : optionalText(row.note), contactEmail: sender.email,
      pickup, dropoff, temperature, packaging: { sizeCode: size, weightKg: nonnegativeNumber(row.weight_kg) },
      schedule: { date, window: optionalText(row.time_window), timezone: null }, money: [money], payment: status.payment,
      observations: {
        sourceZone: zone == null ? null : zone as number, sourceSpeed: speed,
        sourceVatRate: vatRate == null ? null : vatRate as number | string, sameLocker: same == null ? null : same as boolean,
        weightUnits,
        routeEstimate: method === "bus" ? { kilometers: nonnegativeNumber(details.bus_km), basis: "source_postcode_centroid_estimate", rateCentsPerKm: parseEuroCents(details.bus_eur_per_km) } : null,
      },
      parts: [], issues,
    }) };
  } catch {
    return invalid(schema, "malformed_source_fields", "", "Source field types, identity or money are invalid; no intake was authorized.");
  }
}

export function adaptLegacyFormV1(record: unknown): IntakeResult { return legacy(record, "legacy-form-v1"); }
export function adaptLegacyLabelV2(record: unknown): IntakeResult { return legacy(record, "legacy-label-v2"); }
