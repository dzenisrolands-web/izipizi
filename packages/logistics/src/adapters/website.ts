import type { Contact, Endpoint, IntakeResult, ReviewIssue, Temperature } from "../contract.ts";
import { createIntake, invalid, isRecord, isUuid, issue, sourceReference, unknownTemperature } from "../core.ts";
import { addressEndpoint, alias, lockerEndpoint, moneyObservation, optionalText, sourceTime, statusObservation } from "./legacy.ts";

const SCHEMA = "website-neon-v1" as const;

function endpoint(value: unknown, issues: ReviewIssue[], path: string): Endpoint {
  if (!isRecord(value)) throw new TypeError("Missing endpoint object");
  const contact: Contact = { name: optionalText(value.name), phone: optionalText(value.phone), email: optionalText(value.email) };
  if (value.kind === "locker") return lockerEndpoint(SCHEMA, value.lockerId, contact, issues, path);
  if (value.kind !== "address") throw new TypeError("Unknown endpoint kind");
  return addressEndpoint(value.address, value.city, value.postalCode, contact, issues, path);
}

/** The retained business lead is not a shipment or a registered client. */
export function adaptWebsiteNeonV1(record: unknown, recordKind: "order" | "business_lead" = "order"): IntakeResult {
  if (recordKind !== "order") return invalid(SCHEMA, "not_a_shipment", "recordKind", "Business leads are not shipment or client-account records.");
  if (!isRecord(record)) return invalid(SCHEMA, "invalid_record", "", "Expected a website order record.");
  try {
    const row = record, issues: ReviewIssue[] = [];
    if (["delivery_type", "price_total", "price_eur", "price_excl_vat", "locker_from", "locker_to"].some((key) => Object.hasOwn(row, key))) {
      return invalid(SCHEMA, "mixed_source_schema", "", "Website Neon and legacy shipment fields must not be mixed.");
    }
    if (!isUuid(row.id)) return invalid(SCHEMA, "invalid_source_id", "id", "Website orders require a full persisted UUID, not a confirmation prefix.");
    const rawMethod = optionalText(row.method);
    if (rawMethod !== "pakomats" && rawMethod !== "standard" && rawMethod !== "express") {
      return invalid(SCHEMA, "invalid_method", "method", "Unsupported or missing website delivery method.");
    }
    const method = rawMethod === "pakomats" ? "locker" : rawMethod === "standard" ? "courier" : "express";
    const temp = optionalText(alias(row, "temp_mode", "tempMode"));
    const modes: Record<string, Temperature["mode"]> = { none: "ambient", chilled: "chilled", frozen: "frozen", both: "dual" };
    let temperature = unknownTemperature(temp);
    if (temp && Object.hasOwn(modes, temp)) temperature = { mode: modes[temp], basis: "explicit_source", raw: temp };
    else issues.push(issue("unknown_temperature", "temp_mode", "Website source temperature is missing or unrecognized."));
    const gross = alias(row, "price_gross", "priceGross"), net = alias(row, "price_net", "priceNet"), vat = alias(row, "vat_rate", "vatRate");
    const money = moneyObservation("website_logistics", gross, net, vat, issues);
    money.sourcePath = Object.hasOwn(row, "price_gross") ? "price_gross" : "priceGross";
    const size = optionalText(alias(row, "compartment_size", "compartmentSize"));
    if (method === "locker" && size !== "M" && size !== "L" && size !== "XL") return invalid(SCHEMA, "invalid_size", "compartment_size", "Website locker size must be M, L or XL.");
    const pickup = endpoint(row.sender, issues, "pickup"), dropoff = endpoint(row.recipient, issues, "dropoff");
    const status = statusObservation(row.status, ["new"], issues);
    const sourceCreatedAt = sourceTime(alias(row, "created_at", "createdAt"), issues);
    const zone = optionalText(row.zone);
    if (zone && !/^z[0-4]$/.test(zone)) issues.push(issue("unknown_source_zone", "zone", "Website zone is not a recognized source zone."));
    return { ok: true, intake: createIntake({
      source: sourceReference(SCHEMA, row.id), sourceStatus: status.status, sourceCreatedAt, method, client: null,
      description: optionalText(row.description), notes: optionalText(row.notes),
      contactEmail: optionalText(alias(row, "contact_email", "contactEmail")),
      pickup, dropoff, temperature, packaging: { sizeCode: size, weightKg: null },
      schedule: { date: null, window: optionalText(alias(row, "time_window", "timeWindow")), timezone: null },
      money: [money], payment: status.payment,
      observations: { sourceZone: zone, sourceSpeed: rawMethod === "pakomats" ? null : rawMethod, sourceVatRate: vat == null ? null : vat as number | string },
      parts: [], issues,
    }) };
  } catch {
    return invalid(SCHEMA, "malformed_source_fields", "", "Source aliases, endpoints, money or field types are invalid; no intake was authorized.");
  }
}
