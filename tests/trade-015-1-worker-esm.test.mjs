import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = [
  "hosted-worker/index.mjs",
  "hosted-worker/notification-worker.mjs",
];
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
async function walk(file, seen = new Set()) {
  const normalized = path.normalize(file);
  if (seen.has(normalized)) return seen;
  seen.add(normalized);
  const source = await readFile(normalized, "utf8");
  for (const match of source.matchAll(importPattern)) {
    assert.match(
      match[1],
      /\.(?:ts|mjs|js|json)$/,
      `${normalized} has extensionless relative import ${match[1]}`,
    );
    const target = path.resolve(path.dirname(normalized), match[1]);
    if (/\.(?:ts|mjs)$/.test(target)) await walk(target, seen);
  }
  return seen;
}
test("Railway trading worker runtime graph uses explicit ESM extensions", async () => {
  const files = await walk(roots[0]);
  assert.ok(
    files.size > 20,
    "expected a complete transitive trading-worker graph",
  );
  assert.ok(
    [...files].some((file) =>
      file.endsWith(path.normalize("market-data/factory.ts")),
    ),
  );
});
test("Railway notification worker runtime graph uses explicit ESM extensions", async () => {
  const files = await walk(roots[1]);
  assert.ok(files.size >= 2);
});
test("worker commands retain native Node TypeScript stripping", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    pkg.scripts["worker:start"],
    "node --experimental-strip-types hosted-worker/index.mjs",
  );
  assert.equal(
    pkg.scripts["worker:notifications"],
    "node --experimental-strip-types hosted-worker/notification-worker.mjs",
  );
});
