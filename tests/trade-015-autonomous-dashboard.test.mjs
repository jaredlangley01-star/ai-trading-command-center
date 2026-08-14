import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateRiskBasedSize,
  classifyMarketRegime,
  portfolioGate,
  rankAutonomousCandidates,
  regimeSuitability,
} from "../src/services/autonomous-decision.ts";

const candidate = (changes = {}) => ({
  symbol: "AAPL",
  direction: "BUY",
  strategy: "Trend Following",
  strategyScore: 85,
  opportunityScore: 88,
  confidence: 90,
  historicalScore: 75,
  riskReward: 2.5,
  regimeSuitability: 95,
  quoteTimestamp: new Date().toISOString(),
  reasons: [],
  ...changes,
});
const config = {
  minimumOpportunityScore: 75,
  minimumConfidence: 65,
  minimumHistoricalScore: 50,
  longEnabled: true,
  shortEnabled: false,
};
test("autonomous candidates rank strongest valid evidence rather than first input", () => {
  const ranked = rankAutonomousCandidates(
    [
      candidate({ symbol: "MSFT", opportunityScore: 78 }),
      candidate({ symbol: "AAPL", opportunityScore: 94 }),
    ],
    config,
  );
  assert.equal(ranked[0].symbol, "AAPL");
  assert.equal(ranked[0].decision, "ELIGIBLE");
});
test("research confidence and historical requirements reject incomplete candidates", () => {
  const [result] = rankAutonomousCandidates(
    [candidate({ confidence: 20, historicalScore: 10 })],
    config,
  );
  assert.deepEqual(result.rejectionReasons, [
    "MINIMUM_CONFIDENCE",
    "INSUFFICIENT_HISTORICAL_EVIDENCE",
  ]);
});
test("market regime classification and strategy suitability are deterministic", () => {
  assert.equal(
    classifyMarketRegime([
      { symbol: "SPY", changePct: 2, volatilityPct: 1 },
      { symbol: "QQQ", changePct: 1.5, volatilityPct: 1.2 },
    ]),
    "BULLISH",
  );
  assert.equal(
    classifyMarketRegime([{ symbol: "SPY", changePct: 0, volatilityPct: 4 }]),
    "HIGH_VOLATILITY",
  );
  assert.ok(
    regimeSuitability("Mean Reversion", "BUY", "SIDEWAYS") >
      regimeSuitability("Trend Following", "BUY", "SIDEWAYS"),
  );
});
test("position sizing is stop-distance and capacity bounded", () => {
  const result = calculateRiskBasedSize({
    equity: 100000,
    buyingPower: 10000,
    entry: 100,
    stop: 95,
    maximumLoss: 250,
    maximumPosition: 5000,
    remainingPortfolioCapacity: 3000,
  });
  assert.deepEqual(result, {
    quantity: 30,
    capital: 3000,
    maximumPlannedLoss: 150,
    reason: "DETERMINISTIC_RISK_SIZE",
  });
});
test("portfolio gates duplicate, concurrent, exposure and strategy concentration", () => {
  const result = portfolioGate({
    symbol: "AAPL",
    direction: "BUY",
    strategy: "Momentum",
    positions: [
      {
        symbol: "AAPL",
        direction: "BUY",
        strategy: "Momentum",
        exposure: 2000,
      },
      {
        symbol: "MSFT",
        direction: "BUY",
        strategy: "Momentum",
        exposure: 2000,
      },
    ],
    equity: 5000,
    maximumPortfolioExposurePct: 70,
    maximumSymbolExposurePct: 20,
    maximumConcurrentPositions: 2,
  });
  for (const reason of [
    "DUPLICATE_POSITION",
    "MAX_CONCURRENT_POSITIONS",
    "MAX_PORTFOLIO_EXPOSURE",
    "MAX_SYMBOL_EXPOSURE",
    "STRATEGY_DIRECTION_CONCENTRATION",
  ])
    assert.ok(result.reasons.includes(reason));
});
test("hosted worker uses intelligence, production strategy, risk, permission and PAPER broker", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  for (const pattern of [
    /intelligence_snapshots/,
    /rankAutonomousCandidates/,
    /CombinedOpportunityEngine/,
    /ProductionRiskManager/,
    /TradePermissionService/,
    /createAlpacaPaperBrokerService/,
    /ALPACA_PAPER/,
    /autonomous_execution_claims/,
  ])
    assert.match(worker, pattern);
  assert.doesNotMatch(worker, /ALPACA_LIVE|api\.alpaca\.markets\/v2\/orders/);
});
test("restart and duplicate protection use durable claims before submission", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /claimOpportunity[\s\S]*autonomous_execution_claims/);
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608140009_trade_015_autonomous_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /unique\(user_id,execution_key\)/i);
});
test("Alpaca authoritative reconciliation persists account positions orders fills", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /broker_reconciliation_runs/);
  assert.match(worker, /ALPACA_AUTHORITATIVE_RECONCILED/);
});
test("stale data and outages block entries while protection stays independent", async () => {
  const decision = await readFile(
      new URL("../src/services/autonomous-decision.ts", import.meta.url),
      "utf8",
    ),
    worker = await readFile(
      new URL("../hosted-worker/index.mjs", import.meta.url),
      "utf8",
    );
  assert.match(decision, /STALE_MARKET_DATA/);
  assert.match(worker, /submitProtectivePaperExit/);
  assert.match(worker, /processAutonomousOwner[\s\S]*catch/);
});
test("autonomous audit records selected and rejected candidate reasons", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /autonomous_candidate_evaluations/);
  assert.match(worker, /rejectionReasons/);
  assert.match(worker, /selected: true/);
  assert.match(worker, /risk_decisions/);
});
test("notifications integrate without becoming an execution dependency", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /Autonomous PAPER Entry/);
  assert.match(worker, /Autonomous Entry Blocked/);
  assert.doesNotMatch(
    worker.match(/async function enqueueNotification[\s\S]*?\n}/)?.[0] ?? "",
    /submitPaperOrder|cancelPaperOrder/,
  );
});
test("candlestick chart normalizes actual bars and exposes modes overlays and selector", async () => {
  const route = await readFile(
      new URL("../app/api/dashboard/route.ts", import.meta.url),
      "utf8",
    ),
    ui = await readFile(
      new URL(
        "../components/professional-market-dashboard.tsx",
        import.meta.url,
      ),
      "utf8",
    );
  for (const pattern of [
    /open: Number\(bar\.o\)/,
    /high: Number\(bar\.h\)/,
    /low: Number\(bar\.l\)/,
    /close: Number\(bar\.c\)/,
  ])
    assert.match(route, pattern);
  for (const pattern of [
    /CandlestickSeries/,
    /PORTFOLIO EQUITY/,
    /Current position/i,
    /ENTRY/,
    /STOP/,
    /TARGET/,
    /CURRENT/,
    /HistogramSeries/,
  ])
    assert.match(ui, pattern);
});
test("market overview batches watchlist and caps historical bars", async () => {
  const route = await readFile(
    new URL("../app/api/dashboard/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /snapshots\?symbols=/);
  assert.match(route, /limit=1000/);
  assert.doesNotMatch(route, /for .*fetch|map\([^)]*fetch/);
});
test("dashboard layout and display currency are durable and display-only", async () => {
  const route = await readFile(
      new URL("../app/api/dashboard/route.ts", import.meta.url),
      "utf8",
    ),
    migration = await readFile(
      new URL(
        "../supabase/migrations/202608140009_trade_015_autonomous_hardening.sql",
        import.meta.url,
      ),
      "utf8",
    );
  assert.match(route, /displayOnly: true/);
  assert.match(route, /dashboard_preferences/);
  assert.match(migration, /Owners manage dashboard preferences/);
  assert.doesNotMatch(route, /submitPaperOrder|RiskManager|position siz/i);
});
test("clocks use IANA timezones and responsive dashboard removes boxed T mark", async () => {
  const ui = await readFile(
      new URL(
        "../components/professional-market-dashboard.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    shell = await readFile(
      new URL("../components/trading-command-center.tsx", import.meta.url),
      "utf8",
    ),
    css = await readFile(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );
  for (const zone of [
    "America/New_York",
    "Europe/London",
    "Africa/Johannesburg",
    "Asia/Tokyo",
    "Australia/Sydney",
  ])
    assert.match(ui, new RegExp(zone));
  assert.doesNotMatch(shell, /<div className="brand-mark">T<\/div>/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
test("hosted autonomous and dashboard paths remain local-free and LIVE locked", async () => {
  const files = await Promise.all(
    [
      "../app/api/dashboard/route.ts",
      "../src/services/autonomous-decision.ts",
      "../components/professional-market-dashboard.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.doesNotMatch(files.join("\n"), /localhost|127\.0\.0\.1|IBKR|TWS/);
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /LIVE_TRADING_LOCKED/);
});
