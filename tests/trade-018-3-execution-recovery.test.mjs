import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { newestAlpacaTimestamp } from "../src/services/market-data/alpaca-market-data-service.ts";
import { classifyWorkerHealth } from "../src/services/notifications/worker-health.ts";
import {
  applyPaperTestThresholds,
  availableTestSlots,
} from "../src/services/paper-automation-test.ts";

const read = (path) => fs.readFileSync(path, "utf8");

test("fresh quote timestamp wins over an older Alpaca trade timestamp", () => {
  assert.equal(
    newestAlpacaTimestamp(
      "2026-08-20T16:00:01-04:00",
      "2026-08-20T19:55:00Z",
      "2026-08-20T19:00:00Z",
    ),
    "2026-08-20T16:00:01-04:00",
  );
  assert.equal(
    Date.parse("2026-08-20T16:00:01-04:00"),
    Date.parse("2026-08-20T20:00:01Z"),
  );
});

test("test-only thresholds and configured universe replace normal entry floors", () => {
  const applied = applyPaperTestThresholds({
    paperTestMode: true,
    paperTestUniverse: ["AAPL", "MSFT", "NVDA", "AMD", "AMZN"],
    paperTestMinimumOpportunityScore: 60,
    paperTestMinimumConfidence: 50,
    paperTestMaximumPositionSize: 1_000,
    paperTestMaximumRiskPerTrade: 100,
    paperTestMaximumDailyTrades: 30,
    allowedAssets: ["AAPL"],
    minimumOpportunityScore: 75,
    minimumConfidence: 70,
    minimumStrategyScore: 70,
    maximumTradeSize: 2_000,
    maximumRiskPerTrade: 200,
    maximumTradesPerDay: 50,
  });
  assert.deepEqual(applied.allowedAssets, [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMD",
    "AMZN",
  ]);
  assert.equal(applied.minimumStrategyScore, 60);
  assert.equal(applied.minimumOpportunityScore, 60);
  assert.equal(applied.minimumConfidence, 50);
  assert.equal(applied.maximumTradeSize, 1_000);
  assert.equal(applied.maximumRiskPerTrade, 100);
  assert.equal(applied.maximumTradesPerDay, 30);
});

test("stress slot calculation covers 0/8, 5/8, and target reached", () => {
  assert.equal(availableTestSlots(8, 0), 8);
  assert.equal(availableTestSlots(8, 5), 3);
  assert.equal(availableTestSlots(8, 8), 0);
});

test("worker health requires a genuinely fresh heartbeat before recovery", () => {
  assert.equal(classifyWorkerHealth(181_000, null, 180_000), "OFFLINE");
  assert.equal(
    classifyWorkerHealth(90_000, "TRADING_ENGINE_OFFLINE", 180_000, 60_000),
    "HYSTERESIS",
  );
  assert.equal(
    classifyWorkerHealth(30_000, "TRADING_ENGINE_OFFLINE", 180_000, 60_000),
    "ONLINE",
  );
});

test("hosted worker exposes cycle, market, queue, heartbeat, and execution diagnostics", () => {
  const worker = read("hosted-worker/index.mjs");
  for (const marker of [
    "worker_cycle_start",
    "worker_cycle_end",
    "cycleDurationMs",
    "heartbeat_write",
    "alpaca_batch_complete",
    "queue_processing_complete",
    "market_data_audit",
    "configuredUniverse",
    "paper_automation_test_cycles",
  ])
    assert.match(worker, new RegExp(marker));
  assert.match(worker, /const heartbeatPulseTimer = setInterval\(/);
  assert.match(worker, /paper_execution_requests/);
  assert.match(worker, /submitPaperOrder/);
  assert.match(worker, /synchronizeOwnerPortfolio/);
  assert.match(worker, /ProtectiveExitService/);
});

test("no simulated broker can create stress positions and LIVE stays blocked", () => {
  const api = read("app/api/auto-trader/route.ts");
  const worker = read("hosted-worker/index.mjs");
  assert.match(api, /BROKER_UNAVAILABLE/);
  assert.match(worker, /ALPACA_PAPER/);
  assert.match(worker, /LIVE_TRADING_LOCKED/);
  assert.match(worker, /brokerBaseUrl !== PAPER_URL/);
});

test("stress-mode orders and fills are owner-visible in CSV exports", () => {
  const route = read("app/api/exports/[kind]/route.ts");
  assert.match(route, /paper_execution_requests/);
  assert.match(route, /paper_broker_fills/);
  assert.match(route, /paper_test_mode/);
  assert.match(route, /test_slot/);
  assert.match(route, /broker_execution_id/);
});

test("additive migration persists decision audit and fill stress metadata", () => {
  const migration = read(
    "supabase/migrations/202608210001_trade_018_3_execution_recovery.sql",
  );
  assert.match(migration, /market_data_audit/);
  assert.match(migration, /test_mode_context/);
  assert.match(migration, /paper_broker_fills/);
  assert.match(migration, /paper_test_mode/);
  assert.match(migration, /test_slot/);
});
