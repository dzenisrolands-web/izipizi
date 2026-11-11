# Logistics intake contracts
Pure, source-only projections for the legacy shipment forms, retained Neon website orders, and marketplace orders. This package is not connected to any deployed application or database.
## Usage
Use Node 24 and the repository's pinned pnpm 9.15.0:
```sh
corepack pnpm logistics:check
corepack pnpm logistics:example
```
The example uses synthetic records only and demonstrates historical 300-cent versus 363-cent gross prices, duplicate detection, and conflicting source snapshots. `build` deliberately runs TypeScript with `--noEmit`; this private package exports TypeScript source, not a deployment artifact.
## Explicit source versions
Call `adaptIntake({ schema, record, ...context })` or an individual adapter:
- `legacy-form-v1`: `adaptLegacyFormV1(record)`. The browser `ref` alone is accepted only as `reference_only`, with a review issue; it is not proof of persistence. Form-specific compartment-size temperature rules apply only here.
- `legacy-label-v2`: `adaptLegacyLabelV2(record)`. Uses its distinct persisted UUID, `delivery_type`, `price_total`, and `temp_mode` fields, not guessed form-v1 rules.
- `website-neon-v1`: `adaptWebsiteNeonV1(record, recordKind)`. Requires the complete UUID; supports persisted snake_case and Drizzle camelCase fields. A `business_lead` is explicitly rejected as a nonshipment.
- `marketplace-order-v1`: `adaptMarketplaceOrderV1(record, sellerSnapshots)`. Reads order/item/delivery snapshots. Only explicitly supplied seller pickup snapshots are projected; seller groups are not automatically courier jobs.
Unknown routing schemas throw `TypeError`. Recognized adapters return `IntakeResult`; invalid identities, incompatible versions, malformed monetary fields, or contradictory ownership fail explicitly. Missing source observations remain unknown or review issues, never invented account IDs, free delivery, coordinates, locker UUIDs, or routing distances.
## Authority and money
Every valid projection runtime-pins and shallow-freezes `dispatchAuthorized: false`, `billingAuthorized: false`, and `payment.verified: false`. Other nested source data is not deeply frozen; callers must treat it as observations, not authorization. Input records are not mutated.
Source `paid`, `apmaksats`, `shipped`, and `delivered` statuses are claims, not provider verification, job persistence, or proof of delivery. A sender confirmation is likewise an unverified source observation.
Amounts retain separate scopes: legacy logistics, website logistics, marketplace delivery, goods, and whole order. Whole-order totals must never be added to their constituent goods/delivery amounts. Aggregate and per-seller delivery observations also overlap; scope alone does not identify additive amounts. Inspect `sourcePath`, `sellerId`, and provenance.
EUR decimals are parsed without sub-cent rounding; absent values remain `null`, not zero. Historical recorded values are not repriced. When marketplace promo allocation is missing or unresolved, per-seller pre-discount observations remain in `money` but `part.deliveryCharge` is `null`; no allocation or invoice amount is fabricated.
The explicit legacy `agenskalns` alias maps to `agenskalna`; the original code remains available. Historical Tukums references remain visible but are marked closed for new work. Neon locker identifiers are not presumed equivalent to marketplace codes. Dates/windows retain unknown timezone; bus-distance observations are source centroid estimates, not verified road routes.
## Private data and review
Canonical intakes contain contacts, addresses, notes, entry codes, and payment references: do not log or return whole projections to an unauthenticated UI.
`reviewIntakes(results)` returns a deliberately limited summary: indices, allowlisted source metadata, issue codes, part counts, duplicate/conflict dispositions, and false authorization flags. It omits source keys, human references, raw statuses, issue messages/paths, amounts, and private customer fields by default. `includeSourceKeys: true` is an explicit opt-in for trusted operator tools.
Comparison is deterministic within the supplied batch: object-key order is ignored, array order is preserved. Repeated identical normalized observations share an identity; different observations for that identity mark **all** its rows as conflicting. UUID case does not create a second source key. Legacy form/label versions describing the same persisted row share a key; different projections are conservatively conflicts, not two shipments. Identity without a persisted UUID is not automatically reconciled to a later database row.
At most 1,000 records are reviewed per call. Oversized, cyclic, nonplain, or structurally unsafe projections fail review rather than authorizing work. A `normalized` or `duplicate` disposition is not approval. This is an in-memory comparison, not durable idempotency or exactly-once import.
## Deliberately excluded
There are no runtime dependencies, environment reads, DB/provider/network imports, migrations, reservation/stock changes, dispatch, invoice issuance, notifications, domain changes, or production scripts. Tests use synthetic data and replace `fetch` with a throwing function; a source-boundary test additionally checks local imports and disallowed infrastructure entrypoints.
Before real integration, separate reviewed work must provide durable identity reconciliation/idempotency, authentication and access control, customer/account linkage, verified endpoint mappings, dispatch eligibility, payment evidence, invoice rules, audit trails, and a rollout/rollback strategy. This package does not implement those capabilities.
