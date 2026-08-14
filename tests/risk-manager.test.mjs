import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultRiskSettings } from "../src/config/trading.ts";
import { ProductionRiskManager } from "../src/services/risk-manager.ts";

const context = (overrides = {}) => ({
  requestedCapital: 2000,
  expectedPrice: 100,
  stopLoss: 95,
  dailyProfitLoss: 0,
  tradesToday: 0,
  concurrentPositions: 0,
  portfolioExposure: 10000,
  autoTraderExposure: 10000,
  assetExposure: 1000,
  portfolioValue: 50000,
  portfolioDrawdownPct: 1,
  source: "AUTO_TRADER",
  emergencyStopActive: false,
  systemLocked: false,
  ...overrides,
});
const manager = (settings = {}) =>
  new ProductionRiskManager({ ...defaultRiskSettings, ...settings });

test("production risk manager approves a trade inside every boundary", async () => {
  const result = await manager().evaluateOrder(context());
  assert.equal(result.status, "APPROVED");
  assert.equal(result.reason, "RISK_CHECKS_PASSED");
});
test("emergency stop always creates a system lock", async () => {
  const result = await manager().evaluateOrder(
    context({ emergencyStopActive: true }),
  );
  assert.deepEqual(
    [result.status, result.reason],
    ["SYSTEM_LOCK", "EMERGENCY_STOP_ACTIVE"],
  );
});
test("daily loss and profit targets lock only automated openings", async () => {
  const loss = await manager().evaluateOrder(
    context({ dailyProfitLoss: -750 }),
  );
  const profit = await manager().evaluateOrder(
    context({ dailyProfitLoss: 1000 }),
  );
  const manual = await manager().evaluateOrder(
    context({ dailyProfitLoss: -750, source: "MANUAL" }),
  );
  assert.equal(loss.reason, "DAILY_LOSS_LIMIT_REACHED");
  assert.equal(profit.reason, "DAILY_PROFIT_TARGET_REACHED");
  assert.equal(loss.status, "DAILY_LOCK");
  assert.equal(manual.status, "APPROVED");
  assert.equal(
    (await manager({ autoTraderEnabled: false }).evaluateOrder(context()))
      .reason,
    "AUTO_TRADER_DISABLED",
  );
  assert.equal(
    (
      await manager().evaluateOrder(
        context({ dailyLocked: true, dailyLockReason: "MAX_TRADES_PER_DAY" }),
      )
    ).reason,
    "MAX_TRADES_PER_DAY",
  );
});
test("trade count and concurrent positions stop new automated risk", async () => {
  assert.equal(
    (await manager().evaluateOrder(context({ tradesToday: 8 }))).reason,
    "MAX_TRADES_PER_DAY",
  );
  assert.equal(
    (await manager().evaluateOrder(context({ concurrentPositions: 4 }))).reason,
    "MAX_CONCURRENT_POSITIONS",
  );
});
test("oversized capital, loss and exposure return reduce-size decisions", async () => {
  const capital = await manager().evaluateOrder(
    context({ requestedCapital: 5000 }),
  );
  const loss = await manager({ maximumCapitalPerTrade: 10000 }).evaluateOrder(
    context({ requestedCapital: 5000, stopLoss: 80 }),
  );
  const exposure = await manager({
    maximumCapitalPerTrade: 10000,
  }).evaluateOrder(context({ requestedCapital: 3000, assetExposure: 9000 }));
  assert.deepEqual(
    [capital.status, capital.reason],
    ["REDUCE_SIZE", "MAX_POSITION_SIZE_EXCEEDED"],
  );
  assert.equal(loss.reason, "MAX_LOSS_PER_TRADE_EXCEEDED");
  assert.equal(exposure.reason, "MAX_ASSET_EXPOSURE_EXCEEDED");
});
test("portfolio and Auto Trader allocation capacity reduce new size", async () => {
  const portfolio = await manager({
    maximumCapitalPerTrade: 10000,
    maximumExposurePerAsset: 100,
    maximumPortfolioExposure: 20,
  }).evaluateOrder(
    context({ requestedCapital: 3000, portfolioExposure: 9000 }),
  );
  const automated = await manager({
    maximumCapitalPerTrade: 10000,
    maximumExposurePerAsset: 100,
    maximumPortfolioExposure: 100,
    autoTraderAllocatedCapital: 12000,
  }).evaluateOrder(
    context({ requestedCapital: 3000, autoTraderExposure: 11000 }),
  );
  assert.deepEqual(
    [portfolio.status, portfolio.reason, portfolio.approvedCapital],
    ["REDUCE_SIZE", "MAX_PORTFOLIO_EXPOSURE_EXCEEDED", 1000],
  );
  assert.equal(automated.status, "REDUCE_SIZE");
  assert.equal(automated.reason, "AUTO_TRADER_CAPITAL_ALLOCATION_EXCEEDED");
  assert.equal(automated.approvedCapital, 1000);
});
test("drawdown, missing stop and big-money threshold are enforced", async () => {
  assert.equal(
    (await manager().evaluateOrder(context({ portfolioDrawdownPct: 12 })))
      .reason,
    "MAX_PORTFOLIO_DRAWDOWN",
  );
  assert.equal(
    (await manager().evaluateOrder(context({ stopLoss: undefined }))).reason,
    "INSUFFICIENT_RISK_CAPACITY",
  );
  assert.equal(
    (
      await manager().evaluateOrder(
        context({ source: "BIG_MONEY", recommendationScore: 84 }),
      )
    ).reason,
    "BIG_MONEY_APPROVAL_REQUIRED",
  );
  assert.equal(
    (await manager().evaluateOrder(context({ expectedPrice: 0 }))).reason,
    "INVALID_ORDER_VALUE",
  );
});
test("risk state and decisions are owner scoped and PAPER mode remains enforced", async () => {
  const [migration, route] = await Promise.all([
    readFile(
      new URL(
        "../supabase/migrations/202608130005_trade_006_production_risk.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/api/broker/orders/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(migration, /risk_decisions/);
  assert.ok((migration.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 3);
  assert.match(route, /mode:\s*"PAPER"/);
  assert.match(route, /ProductionRiskManager/);
});
