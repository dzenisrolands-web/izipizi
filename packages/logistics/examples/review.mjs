import { adaptIntake, reviewIntakes } from "../src/index.ts";

globalThis.fetch = () => { throw new Error("Synthetic example must remain offline"); };

const legacy = {
  schema: "legacy-form-v1",
  record: {
    ref: "IZI-SYNTHETIC-ONLY", status: "jauns", method: "locker", size: "M",
    locker_from: "agenskalns", locker_to: "brivibas", price_eur: "3.00",
    price_excl_vat: "2.48", vat_rate: 0.21,
  },
};
const website = {
  schema: "website-neon-v1",
  record: {
    id: "11111111-1111-4111-8111-111111111111", status: "new", method: "pakomats",
    temp_mode: "chilled", compartment_size: "M", price_net: "3.00",
    price_gross: "3.63", vat_rate: "0.21",
    sender: { kind: "locker", lockerId: "synthetic-neon-origin" },
    recipient: { kind: "locker", lockerId: "synthetic-neon-destination" },
  },
};
const marketplace = {
  schema: "marketplace-order-v1",
  record: {
    id: "22222222-2222-4222-8222-222222222222", order_number: "SYNTHETIC-MARKET",
    status: "pending", payment_status: "pending", delivery_type: "locker",
    total_cents: 800, promo_discount_cents: 0,
    items: [{ id: "synthetic-product", seller_id: "33333333-3333-4333-8333-333333333333", quantity: 1, price: "5.00", storage_type: "chilled" }],
    seller_ids: ["33333333-3333-4333-8333-333333333333"],
    delivery_info: { locker_id: "agenskalna", delivery_fee_cents: 300 },
  },
};
const observations = [legacy, website, marketplace].map(adaptIntake);
if (observations.some(result => !result.ok)) throw new Error("Synthetic example must normalize all three channels");
const conflict = adaptIntake({ ...legacy, record: { ...legacy.record, status: "apmaksats" } });
console.log(JSON.stringify({
  syntheticOnly: true,
  recordedGrossCents: {
    legacy: observations[0].intake.money[0].grossCents,
    website: observations[1].intake.money[0].grossCents,
  },
  review: reviewIntakes([...observations, observations[1], conflict]),
}, null, 2));
