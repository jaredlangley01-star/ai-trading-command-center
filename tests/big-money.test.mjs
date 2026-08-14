import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultRiskSettings } from "../src/config/trading.ts";
import { ResearchEngine } from "../src/services/research-engine.ts";
import { validateRecommendationForApproval } from "../src/services/recommendation-safety.ts";

const asset = {
  id: "aapl",
  symbol: "AAPL",
  name: "Apple",
  assetClass: "EQUITY",
  currency: "USD",
};
const opportunity = {
  symbol: "AAPL",
  supportingStrategies: ["Trend Following", "Momentum"],
  conflictingStrategies: ["Mean Reversion"],
  combinedScore: 84,
  finalRecommendation: "BUY",
  signals: [],
  timestamp: "2026-08-14T10:00:01Z",
  dataSource: "ALPACA — IEX",
  marketDataTimestamp: "2026-08-14T10:00:00Z",
  marketAnalysis: {
    bid: 225.9,
    ask: 226.1,
    last: 226,
    volatility: 0.03,
    trend: "UP",
    momentum: 4.2,
  },
};

test("research combines strategy, market, portfolio and risk inputs", async () => {
  const recommendation = await new ResearchEngine().build(
    asset,
    opportunity,
    defaultRiskSettings,
    12500,
    new Date("2026-08-14T10:00:02Z"),
  );
  assert.equal(recommendation.status, "PENDING");
  assert.equal(recommendation.dataSource, "ALPACA — IEX");
  assert.equal(recommendation.quoteTimestamp, "2026-08-14T10:00:00Z");
  assert.equal(recommendation.portfolioExposure, 12500);
  assert.equal(recommendation.riskProfiles.length, 3);
  assert.deepEqual(
    recommendation.riskProfiles.map((profile) => profile.name),
    ["Conservative", "Recommended", "Aggressive"],
  );
  assert.deepEqual(recommendation.unavailableResearch, [
    "LIVE_NEWS",
    "FUNDAMENTALS",
    "AI_RESEARCH",
  ]);
});

test("approval safety requires confirmation, pending status and unexpired price", () => {
  const valid = {
    status: "PENDING",
    expiresAt: "2026-08-14T10:30:00Z",
    referencePrice: 100,
    currentPrice: 100.5,
    paperConfirmed: true,
  };
  assert.doesNotThrow(() =>
    validateRecommendationForApproval(
      valid,
      Date.parse("2026-08-14T10:00:00Z"),
      1,
    ),
  );
  assert.throws(
    () =>
      validateRecommendationForApproval({ ...valid, paperConfirmed: false }),
    /PAPER_CONFIRMATION_REQUIRED/,
  );
  assert.throws(
    () => validateRecommendationForApproval({ ...valid, status: "APPROVED" }),
    /RECOMMENDATION_NOT_PENDING/,
  );
  assert.throws(
    () =>
      validateRecommendationForApproval(
        valid,
        Date.parse("2026-08-14T11:00:00Z"),
      ),
    /RECOMMENDATION_EXPIRED/,
  );
  assert.throws(
    () =>
      validateRecommendationForApproval(
        { ...valid, currentPrice: 103 },
        Date.parse("2026-08-14T10:00:00Z"),
        1,
      ),
    /MARKET_CONDITIONS_CHANGED_REFRESH_REQUIRED/,
  );
});

test("approval route rechecks freshness, risk, permission and IBKR PAPER", async () => {
  const route = await readFile(
    new URL("../app/api/big-money/route.ts", import.meta.url),
    "utf8",
  );
  for (const required of [
    "assertFreshMarketQuote",
    "validateRecommendationForApproval",
    "ProductionRiskManager",
    "TradePermissionService",
    "PaperOrderService",
    "createPaperBroker",
    'mode: "PAPER"',
    'source: "BIG_MONEY"',
  ])
    assert.match(
      route,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  assert.ok(route.indexOf("paperConfirmed") < route.indexOf("submit("));
  assert.ok(
    route.indexOf("assertFreshMarketQuote") < route.lastIndexOf("submit("),
  );
  assert.doesNotMatch(route, /SimulatedPaperBrokerService|mode:\s*"LIVE"/);
});

test("owner modifications are versioned and revalidated only at approval", async () => {
  const route = await readFile(
    new URL("../app/api/big-money/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /recommendation_versions/);
  assert.match(route, /OWNER_MODIFIED/);
  assert.match(route, /selected_risk_profile/);
  assert.match(route, /new ProductionRiskManager/);
});

test("Big Money persistence is owner-scoped with internal lifecycle events", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608140002_trade_009_big_money.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const table of [
    "research_runs",
    "recommendation_versions",
    "recommendation_events",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table ${table} enable row level security`),
    );
  }
  assert.ok((migration.match(/auth\.uid\(\)=user_id/g) ?? []).length >= 6);
  for (const event of [
    "NEW_RECOMMENDATION",
    "EXPIRING_SOON",
    "EXPIRED",
    "APPROVAL_REQUIRED",
    "BLOCKED_MARKET_CHANGE",
  ])
    assert.match(migration, new RegExp(event));
});

test("UI requires PAPER confirmation and never calls Alpaca execution", async () => {
  const [ui, alpaca] = await Promise.all([
    readFile(
      new URL("../components/trading-command-center.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/services/market-data/alpaca-market-data-service.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(ui, /CONFIRM PAPER TRADE ONLY/);
  assert.match(ui, /Model signal score · not a probability of profit/);
  assert.match(ui, /Model research score · not a probability of profit/);
  assert.doesNotMatch(alpaca, /submitPaperOrder|placeOrder|orders\//);
});

test("market-data failure blocks new approval without position liquidation", async () => {
  const route = await readFile(
    new URL("../app/api/big-money/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /assertFreshMarketQuote/);
  assert.doesNotMatch(route, /closePosition|liquidate|cancelPaperOrder/);
});
