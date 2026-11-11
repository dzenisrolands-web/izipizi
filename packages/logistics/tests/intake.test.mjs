import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { adaptIntake } from "../src/index.ts";

globalThis.fetch = () => { throw new Error("Adapters must not contact infrastructure"); };

test("routing requires explicit known version and does not guess legacy", () => {
  for (const schema of ["legacy-form-v1", "legacy-label-v2", "website-neon-v1", "marketplace-order-v1"]) {
    const result = adaptIntake({ schema, record: null });
    assert.equal(result.ok, false);
    assert.equal(result.schema, schema);
  }
  for (const input of [null, {}, { schema: "unknown", record: {} }, { schema: "__proto__", record: {} }]) {
    assert.throws(() => adaptIntake(input), TypeError);
  }
  assert.equal(adaptIntake({ schema: "website-neon-v1", record: {}, recordKind: "business_lead" }).ok, false);
});

test("runtime package contains only local pure imports and no infrastructure entrypoints", () => {
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter(name => name.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|require)\s*\(|\bprocess\.env\b|\bDate\.now\s*\(|\bMath\.random\s*\(|\bimport\s*\(/, file);
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      assert.match(match[1], /^\.\.?\/.*\.ts$/, `${file}: ${match[1]}`);
    }
  }
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
});
