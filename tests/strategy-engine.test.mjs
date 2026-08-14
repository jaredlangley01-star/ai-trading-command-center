import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DemoMarketDataService } from "../src/services/market-data/demo-market-data-service.ts";
import { MarketDataEngine } from "../src/services/market-data-engine.ts";
import { BreakoutStrategy } from "../src/services/strategies/breakout.ts";
import { CombinedOpportunityEngine } from "../src/services/strategies/combined-opportunity-engine.ts";
import { MeanReversionStrategy } from "../src/services/strategies/mean-reversion.ts";
import { MomentumStrategy } from "../src/services/strategies/momentum.ts";
import { TrendFollowingStrategy } from "../src/services/strategies/trend-following.ts";

const asset = {
  id: "aapl",
  symbol: "AAPL",
  name: "Apple",
  assetClass: "EQUITY",
  currency: "USD",
};
const invalidInput = {
  asset,
  quote: {
    assetId: "aapl",
    bid: 0,
    ask: 0,
    last: 0,
    asOf: new Date().toISOString(),
    source: "INVALID",
    isDemo: true,
    isDelayed: false,
    provider: "DEMO",
    feed: "SIMULATED",
  },
  candles: [],
  timestamp: new Date().toISOString(),
};

test("all strategies return NO_TRADE for invalid market data", () => {
  for (const strategy of [
    new TrendFollowingStrategy(),
    new MomentumStrategy(),
    new BreakoutStrategy(),
    new MeanReversionStrategy(),
  ]) {
    const result = strategy.evaluate(invalidInput);
    assert.equal(result.direction, "NO_TRADE");
    assert.equal(result.score, 0);
    assert.equal(result.entrySuggestion, null);
  }
});
test("strategy modules generate normalized structured signals", async () => {
  const provider = new DemoMarketDataService();
  const quote = await provider.getQuote(asset);
  const candles = await provider.getHistoricalCandles(asset, "2 M", "1 day");
  for (const strategy of [
    new TrendFollowingStrategy(),
    new MomentumStrategy(),
    new BreakoutStrategy(),
    new MeanReversionStrategy(),
  ]) {
    const result = strategy.evaluate({
      asset,
      quote,
      candles,
      timestamp: new Date().toISOString(),
    });
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(["BUY", "SELL", "NO_TRADE"].includes(result.direction));
    assert.equal(result.symbol, "AAPL");
    assert.ok(result.reasoning.length > 10);
  }
});
test("combined engine handles conflicting strategies conservatively", async () => {
  const makeSignal = (name, direction) => ({
    name,
    evaluate: (input) => ({
      symbol: input.asset.symbol,
      direction,
      strategyName: name,
      score: 80,
      entrySuggestion: 100,
      stopLossSuggestion: 95,
      takeProfitSuggestion: 110,
      riskReward: 2,
      reasoning: `${name} controlled test signal`,
      timestamp: input.timestamp,
    }),
  });
  const engine = new CombinedOpportunityEngine(
    new MarketDataEngine(new DemoMarketDataService()),
    [makeSignal("Buyer", "BUY"), makeSignal("Seller", "SELL")],
  );
  const result = await engine.evaluate(asset);
  assert.equal(result.finalRecommendation, "NO_TRADE");
  assert.deepEqual(result.conflictingStrategies.sort(), ["Buyer", "Seller"]);
});
test("combined engine exposes required market inputs and source", async () => {
  const result = await new CombinedOpportunityEngine(
    new MarketDataEngine(new DemoMarketDataService()),
  ).evaluate(asset);
  assert.equal(result.dataSource, "DEMO DATA");
  assert.ok(result.marketAnalysis.bid > 0);
  assert.ok(result.marketAnalysis.ask > result.marketAnalysis.bid);
  assert.ok(Number.isFinite(result.marketAnalysis.volatility));
  assert.ok(Number.isFinite(result.marketAnalysis.momentum));
});
test("strategy code cannot place orders or import broker adapters", async () => {
  const files = await Promise.all(
    [
      "trend-following.ts",
      "momentum.ts",
      "breakout.ts",
      "mean-reversion.ts",
      "combined-opportunity-engine.ts",
    ].map((file) =>
      readFile(
        new URL(`../src/services/strategies/${file}`, import.meta.url),
        "utf8",
      ),
    ),
  );
  const source = files.join("\n");
  assert.doesNotMatch(
    source,
    /submitPaperOrder|BrokerService|from ["'][^"']*broker|orders?\//i,
  );
});
test("UI identifies scores as signal strength and never profit probability", async () => {
  const ui = await readFile(
    new URL("../components/trading-command-center.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /NORMALIZED SIGNAL STRENGTH/);
  assert.match(ui, /NOT A[\s\S]*PROBABILITY OF PROFIT/);
  assert.doesNotMatch(ui, /PROFIT PROBABILITY|WIN PROBABILITY/i);
});
test("strategy persistence tables are owner scoped by RLS", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608130006_trade_007_strategy_engine.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const table of [
    "strategy_signals",
    "strategy_opportunities",
    "strategy_evaluations",
  ]) {
    assert.match(migration, new RegExp(`${table} enable row level security`));
  }
  assert.ok((migration.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 6);
});
test("LIVE lock and Emergency Stop safety layers remain present", async () => {
  const [permission, adapter] = await Promise.all([
    readFile(
      new URL("../src/services/trade-permission.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/services/broker/ib-gateway-broker-service.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(permission, /emergencyStopActive/);
  assert.match(adapter, /LIVE_TRADING_LOCKED/);
  assert.match(adapter, /4002, 7497/);
});
