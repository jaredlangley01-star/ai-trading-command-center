import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}
test("renders a safe owner setup state when Supabase is not configured", async () => {
  const response = await render();
  assert.ok([200, 307].includes(response.status));
  if (response.status === 307) {
    assert.equal(response.headers.get("location"), "/login");
    return;
  }
  const html = await response.text();
  assert.match(html, /<title>Trading Command Center<\/title>/i);
  assert.match(html, /Supabase setup is incomplete/);
  assert.match(html, /OWNER_SETUP_TRADE-003.md/);
  assert.match(html, /PAPER ONLY/);
  assert.match(html, /LIVE TRADING LOCKED/);
  assert.doesNotMatch(html, /codex-preview/);
});
test("setup state contains no broker execution implementation", async () => {
  const source = await readFile(
    new URL("../components/setup-required.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /No credentials have been invented/);
  assert.doesNotMatch(source, /api\.alpaca|interactivebrokers|submitOrder\(/i);
});
