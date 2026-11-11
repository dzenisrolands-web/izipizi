export const INTAKE_VERSION = "logistics-intake-v1" as const;

export type SourceSchema =
  | "legacy-form-v1"
  | "legacy-label-v2"
  | "website-neon-v1"
  | "marketplace-order-v1";

export type SourceSystem = "legacy_supabase" | "website_neon" | "marketplace";
export type ReviewIssue = {
  code: string;
  path: string;
  severity: "review" | "blocking";
  message: string;
};

export type SourceReference = {
  system: SourceSystem;
  schema: SourceSchema;
  id: string;
  idKind: "persisted_id" | "reference_only";
  reference: string | null;
  key: string;
};

export type Contact = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export type LockerReference = {
  namespace: string;
  code: string;
  marketplaceCode: string | null;
  availability: "known" | "closed_for_new_work" | "unmapped";
};

export type Endpoint = {
  kind: "address" | "locker" | "unknown";
  contact: Contact;
  address: {
    raw: string | null;
    street: string | null;
    city: string | null;
    postalCode: string | null;
    apartment?: string | null;
    floor?: string | null;
    entryCode?: string | null;
  } | null;
  locker: LockerReference | null;
};

export type Temperature = {
  mode: "ambient" | "chilled" | "frozen" | "dual" | "cold_unspecified" | "hot" | "unknown";
  basis: "explicit_source" | "source_size_rule" | "unknown";
  raw: string | number | null;
};

export type MoneyScope =
  | "legacy_logistics"
  | "website_logistics"
  | "marketplace_delivery"
  | "marketplace_goods"
  | "marketplace_order_total";

/** An observed source amount is not an approved invoice or verified payment. */
export type MoneyObservation = {
  scope: MoneyScope;
  currency: "EUR";
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  verification: "unverified_source";
  rawGross?: string | number | null;
  rawNet?: string | number | null;
};

export type SourceItem = {
  listingId: string | null;
  variantId: string | null;
  cartItemId: string | null;
  title: string | null;
  quantity: number | null;
  unitGrossCents: number | null;
  temperature: Temperature;
};

/** Source seller group, not an automatically created delivery job. */
export type FulfillmentPart = {
  key: string;
  sellerId: string | null;
  pickup: Endpoint;
  items: SourceItem[];
  temperature: Temperature;
  deliveryCharge: MoneyObservation | null;
};

export type MarketplaceSellerSnapshot = {
  sellerId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  pickup?: Endpoint | null;
};

export type CanonicalIntake = {
  version: typeof INTAKE_VERSION;
  source: SourceReference;
  sourceStatus: string | null;
  method: "locker" | "courier" | "express" | "bus" | "unknown";
  client: {
    namespace: string;
    id: string;
    verification: "source_observation";
  } | null;
  pickup: Endpoint;
  dropoff: Endpoint;
  temperature: Temperature;
  packaging: { sizeCode: string | null; weightKg: number | null };
  schedule: { date: string | null; window: string | null; timezone: null };
  money: MoneyObservation[];
  payment: {
    reportedStatus: "paid" | "pending" | "refunded" | "unknown";
    raw: string | null;
    verified: false;
  };
  parts: FulfillmentPart[];
  issues: ReviewIssue[];
  dispatchAuthorized: false;
  billingAuthorized: false;
};

export type IntakeResult =
  | { ok: true; intake: CanonicalIntake }
  | { ok: false; schema: SourceSchema; issues: ReviewIssue[] };

export type IntakeInput = {
  schema: SourceSchema;
  record: unknown;
  recordKind?: "order" | "business_lead";
  sellerSnapshots?: readonly MarketplaceSellerSnapshot[];
};
