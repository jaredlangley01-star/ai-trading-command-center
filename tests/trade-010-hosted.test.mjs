import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(
  new URL("../hosted-worker/index.mjs", import.meta.url),
  "utf8",
);
const runtime = await readFile(
  new URL("../src/config/runtime.ts", import.meta.url),
  "utf8",
);
const railway = JSON.parse(
  await readFile(new URL("../railway.json", import.meta.url), "utf8"),
);

test("hosted worker hard-locks Alpaca PAPER and IEX", () => {
  assert.match(worker, /ALPACA_PAPER/);
  assert.match(worker, /LIVE_TRADING_LOCKED/);
  assert.match(worker, /paper-api\.alpaca\.markets/);
  assert.match(worker, /IEX_FEED_REQUIRED/);
});

test("hosted runtime rejects localhost infrastructure", () => {
  assert.match(runtime, /localhost\|127\\\.0/);
  assert.match(runtime, /4001/);
  assert.match(runtime, /7497/);
});

test("Railway starts only the persistent hosted worker", () => {
  assert.equal(railway.deploy.startCommand, "npm run worker:start");
  assert.equal(railway.deploy.restartPolicyType, "ON_FAILURE");
});

test("worker performs no automatic deployment order", () => {
  assert.doesNotMatch(worker, /\/v2\/orders["'`],\s*\{\s*method:\s*["']POST/);
});
