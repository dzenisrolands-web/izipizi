import type { CanonicalIntake, IntakeResult, SourceReference } from "./contract.ts";
import { sourceReference } from "./core.ts";

export type ReviewRow = {
  index: number;
  disposition: "normalized" | "duplicate" | "conflict" | "invalid";
  duplicateOf: number | null;
  source: Pick<SourceReference, "system" | "schema" | "idKind"> | null;
  sourceKey?: string;
  issueCodes: string[];
  partCount: number;
  dispatchAuthorized: false;
  billingAuthorized: false;
};

export type IntakeReview = {
  recordsSeen: number;
  uniqueSources: number;
  normalizedSources: number;
  duplicateRecords: number;
  conflictingSources: number;
  conflictingRecords: number;
  invalidRecords: number;
  rows: ReviewRow[];
  dispatchAuthorized: false;
  billingAuthorized: false;
};

/** Stable object keys, but array order is meaningful and must not be erased. */
function observationFingerprint(value: unknown): string {
  const seen = new Set<object>();
  let nodes = 0;
  function walk(item: unknown, depth: number): unknown {
    nodes++;
    if (depth > 32 || nodes > 50000) throw new TypeError("Observation exceeds review limit");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || seen.has(item)) throw new TypeError("Invalid observation");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError("Observation must contain only plain source data");
    }
    seen.add(item);
    let result: unknown;
    if (Array.isArray(item)) result = item.map(entry => walk(entry, depth + 1));
    else {
      const entries: [string, unknown][] = [];
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (descriptor.get || descriptor.set) throw new TypeError("Observation cannot contain accessors");
        if (descriptor.value !== undefined) entries.push([key, walk(descriptor.value, depth + 1)]);
      }
      result = Object.fromEntries(entries);
    }
    seen.delete(item);
    return result;
  }
  const serialized = JSON.stringify(walk(value, 0));
  if (serialized.length > 262144) throw new TypeError("Observation exceeds review size");
  return serialized;
}

function validProjection(intake: CanonicalIntake): boolean {
  if (intake.dispatchAuthorized !== false || intake.billingAuthorized !== false || intake.payment.verified !== false) return false;
  const expected = sourceReference(intake.source.schema, intake.source.id, intake.source.reference, intake.source.idKind);
  return expected.key === intake.source.key && expected.system === intake.source.system;
}

/** Batch-local comparison only: no DB idempotency, import, payment or dispatch. */
export function reviewIntakes(
  results: readonly IntakeResult[], options: { includeSourceKeys?: boolean } = {},
): IntakeReview {
  if (!Array.isArray(results) || results.length > 1000) throw new RangeError("Review at most 1000 records at a time");
  const rows: ReviewRow[] = [];
  const groups = new Map<string, { indices: number[]; fingerprints: Set<string> }>();
  for (let index = 0; index < results.length; index++) {
    const result: IntakeResult = results[index];
    const row: ReviewRow = {
      index, disposition: "invalid", duplicateOf: null, source: null,
      issueCodes: [], partCount: 0, dispatchAuthorized: false, billingAuthorized: false,
    };
    if (!result.ok) {
      row.issueCodes = result.issues.map(issue => /^[a-z][a-z0-9_-]{0,79}$/i.test(issue.code) ? issue.code : "INVALID_ISSUE_CODE");
      rows.push(row);
      continue;
    }
    try {
      const intake = result.intake;
      if (!validProjection(intake)) throw new TypeError("Projection is not a source observation");
      const fingerprint = observationFingerprint(intake);
      row.source = { system: intake.source.system, schema: intake.source.schema, idKind: intake.source.idKind };
      if (options.includeSourceKeys === true) row.sourceKey = intake.source.key;
      row.partCount = intake.parts.length;
      row.issueCodes = intake.issues.map(issue => /^[a-z][a-z0-9_-]{0,79}$/i.test(issue.code) ? issue.code : "INVALID_ISSUE_CODE");
      const group = groups.get(intake.source.key) ?? { indices: [], fingerprints: new Set<string>() };
      group.indices.push(index);
      group.fingerprints.add(fingerprint);
      groups.set(intake.source.key, group);
    } catch {
      row.source = null;
      delete row.sourceKey;
      row.partCount = 0;
      row.issueCodes = ["INVALID_PROJECTION"];
    }
    rows.push(row);
  }
  let normalizedSources = 0, conflictingSources = 0;
  for (const group of groups.values()) {
    if (group.fingerprints.size > 1) {
      conflictingSources++;
      for (const index of group.indices) rows[index].disposition = "conflict";
    } else {
      normalizedSources++;
      for (const [position, index] of group.indices.entries()) {
        rows[index].disposition = position === 0 ? "normalized" : "duplicate";
        rows[index].duplicateOf = position === 0 ? null : group.indices[0];
      }
    }
  }
  return {
    recordsSeen: results.length, uniqueSources: groups.size, normalizedSources,
    duplicateRecords: rows.filter(row => row.disposition === "duplicate").length,
    conflictingSources,
    conflictingRecords: rows.filter(row => row.disposition === "conflict").length,
    invalidRecords: rows.filter(row => row.disposition === "invalid").length,
    rows, dispatchAuthorized: false, billingAuthorized: false,
  };
}
