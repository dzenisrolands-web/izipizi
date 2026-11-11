import {
  INTAKE_VERSION,
  type CanonicalIntake, type Contact, type Endpoint, type IntakeResult,
  type LockerReference, type MoneyObservation, type MoneyScope,
  type ReviewIssue, type SourceReference, type SourceSchema, type SourceSystem, type Temperature,
} from "./contract.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown, max = 2000): string | null {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value.trim() || null;
}

export function issue(code: string, path: string, message: string, severity: ReviewIssue["severity"] = "review"): ReviewIssue {
  return { code, path, message, severity };
}

export function invalid(schema: SourceSchema, code: string, path: string, message: string): IntakeResult {
  return { ok: false, schema, issues: [issue(code, path, message, "blocking")] };
}

const systems: Record<SourceSchema, SourceSystem> = {
  "legacy-form-v1": "legacy_supabase",
  "legacy-label-v2": "legacy_supabase",
  "website-neon-v1": "website_neon",
  "marketplace-order-v1": "marketplace",
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function sourceReference(
  schema: SourceSchema, id: unknown, reference: unknown = null,
  idKind: SourceReference["idKind"] = "persisted_id",
): SourceReference {
  if (idKind !== "persisted_id" && idKind !== "reference_only") throw new TypeError("Invalid source identity kind");
  if (!Object.hasOwn(systems, schema) || typeof id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)) throw new TypeError("Invalid source identity");
  if ((schema === "website-neon-v1" || schema === "marketplace-order-v1" ||
      idKind === "persisted_id") && !isUuid(id)) throw new TypeError("Full persisted UUID required");
  if (idKind === "reference_only" && schema !== "legacy-form-v1") throw new TypeError("Reference-only identity is not supported");
  const humanReference = reference == null ? null : text(reference, 200);
  if (reference != null && !humanReference) throw new TypeError("Invalid source reference");
  // Both legacy schema versions describe one underlying sutijumi table.
  const system = systems[schema];
  return { system, schema, id, idKind, reference: humanReference,
    key: `${system}/${idKind}/${encodeURIComponent(id)}` };
}

export function parseIntegerCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid integer cents");
  return value;
}

export function parseEuroCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    const cents = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents) ||
        Math.abs(value * 100 - cents) > 0.000001) throw new TypeError("Invalid EUR amount");
    return cents;
  }
  if (typeof value !== "string" || value.length > 32) throw new TypeError("Invalid EUR decimal");
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) throw new TypeError("Invalid EUR decimal");
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Unsafe EUR amount");
  return Number(amount);
}

export function observedMoney(
  scope: MoneyScope, grossCents: number | null,
  netCents: number | null = null, vatCents: number | null = null,
): MoneyObservation {
  parseIntegerCents(grossCents); parseIntegerCents(netCents); parseIntegerCents(vatCents);
  if (grossCents !== null && netCents !== null && netCents > grossCents) throw new TypeError("Inconsistent observed money");
  if (grossCents !== null && netCents !== null && vatCents !== null &&
      netCents + vatCents !== grossCents) throw new TypeError("Inconsistent observed money");
  return { scope, currency: "EUR", grossCents, netCents, vatCents, verification: "unverified_source" };
}

export function emptyContact(): Contact {
  return { name: null, phone: null, email: null };
}

export function unknownEndpoint(contact: Contact = emptyContact()): Endpoint {
  return { kind: "unknown", contact: { ...contact }, address: null, locker: null };
}

export function unknownTemperature(raw: Temperature["raw"] = null): Temperature {
  return { mode: "unknown", basis: "unknown", raw };
}

const knownLockerCodes = new Set(["brivibas", "salaspils", "agenskalna", "tukums", "dundaga", "ikskile", "iukstes", "sigulda"]);

/** This is an explicit code alias only, never a guessed physical locker UUID. */
export function lockerReference(namespace: string, code: unknown): LockerReference | null {
  const value = text(code, 200);
  if (!value) return null;
  const supportsMarketplaceCodes = namespace === "legacy-form-v1" || namespace === "legacy-label-v2" || namespace === "marketplace-order-v1";
  const marketplaceCode = supportsMarketplaceCodes
    ? value === "agenskalns" ? "agenskalna" : knownLockerCodes.has(value) ? value : null
    : null;
  return { namespace, code: value, marketplaceCode,
    availability: marketplaceCode === "tukums" ? "closed_for_new_work" : marketplaceCode ? "known" : "unmapped" };
}

/** A projection is never a dispatch, invoice, payment or delivery authorization. */
export function createIntake(
  input: Omit<CanonicalIntake, "version" | "dispatchAuthorized" | "billingAuthorized">,
): CanonicalIntake {
  return Object.freeze({
    ...input,
    payment: Object.freeze({ ...input.payment, verified: false }),
    version: INTAKE_VERSION, dispatchAuthorized: false, billingAuthorized: false,
  });
}
