import type { IntakeInput, IntakeResult } from "./contract.ts";
import { isRecord } from "./core.ts";
import { adaptLegacyFormV1, adaptLegacyLabelV2 } from "./adapters/legacy.ts";
import { adaptWebsiteNeonV1 } from "./adapters/website.ts";
import { adaptMarketplaceOrderV1 } from "./adapters/marketplace.ts";

/** The caller must declare the source version: never guess it from row shape. */
export function adaptIntake(input: IntakeInput): IntakeResult {
  if (!isRecord(input)) throw new TypeError("An explicit intake source envelope is required");
  switch (input.schema) {
    case "legacy-form-v1": return adaptLegacyFormV1(input.record);
    case "legacy-label-v2": return adaptLegacyLabelV2(input.record);
    case "website-neon-v1": return adaptWebsiteNeonV1(input.record, input.recordKind);
    case "marketplace-order-v1": return adaptMarketplaceOrderV1(input.record, input.sellerSnapshots);
    default: throw new TypeError("Unsupported intake source schema");
  }
}
