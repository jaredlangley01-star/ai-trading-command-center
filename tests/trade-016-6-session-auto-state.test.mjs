import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyEquityMarketSession,
  evaluateSessionQuoteFreshness,
  marketOrderAvailability,
} from "../src/services/market-data/session-freshness.ts";

const clock = (overrides = {}) => ({
  isOpen: false,
  nextOpen: "2026-08-18T09:30:00-04:00",
  nextClose: "2026-08-18T16:00:00-04:00",
  observedAt: "2026-08-17T17:00:00-04:00",
  isTradingDay: true,
  ...overrides,
});

test("fresh quote during regular session remains strictly current", () => {
  const now = new Date("2026-08-17T14:00:00Z");
  const result = evaluateSessionQuoteFreshness({
    quoteTimestamp: "2026-08-17T13:59:48Z",
    clock: clock({ isOpen: true }),
    now,
    regularMaxAgeMs: 120_000,
  });
  assert.equal(result.session, "REGULAR");
  assert.equal(result.state, "CURRENT");
  assert.equal(result.ageMs, 12_000);
});

test("genuinely stale regular-session quote is blocked", () => {
  const result = evaluateSessionQuoteFreshness({
    quoteTimestamp: "2026-08-17T13:55:00Z",
    clock: clock({ isOpen: true }),
    now: new Date("2026-08-17T14:00:00Z"),
    regularMaxAgeMs: 120_000,
  });
  assert.equal(result.state, "STALE_DATA");
  assert.equal(
    marketOrderAvailability(result.session, result.state).code,
    "STALE_DATA",
  );
});

test("closed market preserves the valid last-session quote without calling it stale", () => {
  const result = evaluateSessionQuoteFreshness({
    quoteTimestamp: "2026-08-17T19:59:30Z",
    clock: clock(),
    now: new Date("2026-08-17T21:30:00Z"),
  });
  assert.equal(result.session, "AFTER_HOURS");
  assert.equal(result.state, "STALE_DATA");
  assert.equal(
    marketOrderAvailability(result.session, result.state).code,
    "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION",
  );

  const overnight = evaluateSessionQuoteFreshness({
    quoteTimestamp: "2026-08-17T19:59:30Z",
    clock: clock({ isTradingDay: false }),
    now: new Date("2026-08-18T02:00:00Z"),
  });
  assert.equal(overnight.state, "MARKET_CLOSED");
  assert.equal(
    marketOrderAvailability(overnight.session, overnight.state).code,
    "MARKET_CLOSED",
  );
});

test("pre-market and after-hours are identified but MARKET orders remain unavailable", () => {
  const pre = classifyEquityMarketSession(
    clock(),
    new Date("2026-08-17T12:00:00Z"),
  );
  const after = classifyEquityMarketSession(
    clock(),
    new Date("2026-08-17T21:00:00Z"),
  );
  assert.equal(pre, "PRE_MARKET");
  assert.equal(after, "AFTER_HOURS");
  assert.equal(
    marketOrderAvailability(pre, "CURRENT").code,
    "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION",
  );
  assert.equal(
    marketOrderAvailability(after, "CURRENT").code,
    "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION",
  );
});

test("weekends and provider-calendar holidays are CLOSED", () => {
  assert.equal(
    classifyEquityMarketSession(clock(), new Date("2026-08-22T14:00:00Z")),
    "CLOSED",
  );
  assert.equal(
    classifyEquityMarketSession(
      clock({ isTradingDay: false }),
      new Date("2026-12-25T15:00:00Z"),
    ),
    "CLOSED",
  );
});

test("no quote is fabricated and session logic never estimates a fill", () => {
  const source = fs.readFileSync(
    new URL(
      "../src/services/market-data/session-freshness.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /estimatedFill|synthetic|Math\.random/);
});

test("Auto Trader state is owner-persisted, worker-observed, and restart-safe", () => {
  const route = fs.readFileSync(
    new URL("../app/api/auto-trader/route.ts", import.meta.url),
    "utf8",
  );
  const worker = fs.readFileSync(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /auto_trader_status: body\.action === "RESUME" \? "ACTIVE" : "PAUSED"/,
  );
  assert.match(route, /emergency_stop_active/);
  assert.match(route, /risk_state/);
  assert.match(route, /workerAcknowledged/);
  assert.match(worker, /system\?\.auto_trader_status !== "ACTIVE"/);
  assert.match(
    worker,
    /autoTrader: autoTraderPermitted \? "SCHEDULED" : "PAUSED"/,
  );
  assert.doesNotMatch(worker, /AUTO_TRADER_INITIAL_STATE/);
});

test("ACTIVE with zero positions is scanning, while paused protection remains independent", () => {
  const ui = fs.readFileSync(
    new URL("../components/trading-command-center.tsx", import.meta.url),
    "utf8",
  );
  const worker = fs.readFileSync(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(ui, /SCANNING \/ WAITING FOR SETUP · ACTIVE TRADES: 0/);
  assert.ok(
    worker.indexOf("manageProtectiveExits") <
      worker.indexOf("processAutonomousOwner"),
  );
});

test("LIVE remains locked and Railway native ESM imports remain explicit", () => {
  const worker = fs.readFileSync(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /LIVE_TRADING_LOCKED/);
  assert.match(worker, /session-freshness\.ts/);
  assert.doesNotMatch(
    worker,
    /from ["'][.]{1,2}\/[^"']+(?<!\.(?:ts|mjs|js|json))["']/,
  );
});
