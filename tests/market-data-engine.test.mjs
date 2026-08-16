import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IBGatewayBrokerService } from "../src/services/broker/ib-gateway-broker-service.ts";
import {
  AutomatedTradingPipeline,
  MarketDataEngine,
} from "../src/services/market-data-engine.ts";
import { TradePermissionService } from "../src/services/trade-permission.ts";

const paperConfig = {
  environment: "PAPER",
  bridgeUrl: "http://127.0.0.1:8765",
  twsHost: "127.0.0.1",
  twsPort: 4002,
  clientId: 41,
  timeoutMs: 10,
};
test("IB Gateway adapter accepts paper ports and rejects live ports", () => {
  assert.doesNotThrow(() => new IBGatewayBrokerService(paperConfig));
  assert.throws(
    () => new IBGatewayBrokerService({ ...paperConfig, twsPort: 4001 }),
    (e) => e.code === "LIVE_TRADING_LOCKED",
  );
  assert.throws(
    () => new IBGatewayBrokerService({ ...paperConfig, environment: "LIVE" }),
    (e) => e.code === "LIVE_TRADING_LOCKED",
  );
});
test("market data failure is contained as an error snapshot", async () => {
  const engine = new MarketDataEngine({
    getQuote: async () => {
      throw new Error("feed down");
    },
    getHistoricalCandles: async () => [],
  });
  const result = await engine.snapshot({
    id: "aapl",
    symbol: "AAPL",
    name: "Apple",
    assetClass: "EQUITY",
    currency: "USD",
  });
  assert.equal(result.status, "ERROR");
  assert.equal(result.quote, null);
  assert.deepEqual(result.candles, []);
});
test("market data engine returns bid ask last and candles", async () => {
  const quote = {
    assetId: "aapl",
    bid: 226,
    ask: 227,
    last: 226.5,
    asOf: new Date().toISOString(),
    source: "IBKR_TWS_PAPER",
    isDemo: false,
    isDelayed: false,
    provider: "IBKR",
    feed: "REALTIME",
  };
  const candles = [
    {
      time: "2026-08-13T10:00:00Z",
      open: 225,
      high: 227,
      low: 224,
      close: 226.5,
      volume: 1000,
    },
  ];
  const engine = new MarketDataEngine({
    getQuote: async () => quote,
    getHistoricalCandles: async () => candles,
  });
  const result = await engine.snapshot({
    id: "aapl",
    symbol: "AAPL",
    name: "Apple",
    assetClass: "EQUITY",
    currency: "USD",
  });
  assert.equal(result.status, "MARKET_DATA_ACTIVE");
  assert.equal(result.quote.bid, 226);
  assert.equal(result.quote.ask, 227);
  assert.equal(result.quote.last, 226.5);
  assert.equal(result.candles.length, 1);
});
test("legacy delayed quotes remain marked without stale hosted UI labels", async () => {
  const quote = {
    assetId: "aapl",
    bid: 225,
    ask: 227,
    last: 226,
    asOf: "2026-08-14T00:00:00Z",
    source: "IBKR_TWS_PAPER_DELAYED",
    isDemo: false,
    isDelayed: true,
    provider: "IBKR",
    feed: "DELAYED",
  };
  const result = await new MarketDataEngine({
    getQuote: async () => quote,
    getHistoricalCandles: async () => [],
  }).snapshot({
    id: "aapl",
    symbol: "AAPL",
    name: "Apple",
    assetClass: "EQUITY",
    currency: "USD",
  });
  assert.equal(result.quote.isDelayed, true);
  assert.equal(result.quote.source, "IBKR_TWS_PAPER_DELAYED");
  const dashboard = await readFile(
    new URL("../components/trading-command-center.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(dashboard, /IBKR PAPER — DELAYED/);
  assert.match(dashboard, /ALPACA — PAPER/);
});
test("strategies cannot import or call IBKR adapters", async () => {
  const [contracts, pipeline] = await Promise.all([
    readFile(new URL("../src/services/contracts.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/services/market-data-engine.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(contracts, /StrategyEngine/);
  assert.match(pipeline, /MarketDataEngine/);
  assert.match(pipeline, /risk\.refresh/);
  assert.doesNotMatch(pipeline, /IBGatewayBrokerService|IBKRBrokerService/);
});
test("automated pipeline orders market strategy risk permission broker", async () => {
  const events = [];
  const asset = {
    id: "aapl",
    symbol: "AAPL",
    name: "Apple",
    assetClass: "EQUITY",
    currency: "USD",
  };
  const quote = {
    assetId: "aapl",
    bid: 226,
    ask: 227,
    last: 226.5,
    asOf: new Date().toISOString(),
    source: "IBKR_TWS_PAPER",
    isDemo: false,
    isDelayed: false,
    provider: "IBKR",
    feed: "REALTIME",
  };
  const market = new MarketDataEngine({
    getQuote: async () => {
      events.push("market");
      return quote;
    },
    getHistoricalCandles: async () => [],
  });
  const permission = new TradePermissionService(
    {
      mode: "PAPER",
      autoTraderStatus: "ACTIVE",
      riskState: "NORMAL",
      emergencyStopActive: false,
    },
    {
      maxRiskPerTradePct: 1,
      maxDailyLossPct: 3,
      maxPortfolioDrawdownPct: 12,
      maxConcurrentPositions: 4,
      maxExposurePerAssetPct: 10,
      autoTraderEnabled: true,
    },
  );
  permission.canOpenTrade = () => {
    events.push("permission");
    return true;
  };
  const pipeline = new AutomatedTradingPipeline(
    market,
    {
      evaluate: async () => {
        events.push("strategy");
        return 90;
      },
    },
    {
      refresh: async () => {
        events.push("risk");
      },
    },
    permission,
    {
      getAccountSummary: async () => {},
      getPositions: async () => [],
      getOrders: async () => [],
      getExecutions: async () => [],
      cancelPaperOrder: async () => {},
      submitPaperOrder: async () => {
        events.push("broker");
        return {
          brokerOrderId: "paper-1",
          status: "SUBMITTED",
          message: "ok",
          mode: "PAPER",
        };
      },
    },
  );
  await pipeline.evaluateAndSubmit(
    asset,
    {
      id: "s1",
      userId: "u1",
      name: "test",
      status: "ACTIVE",
      assetClasses: ["EQUITY"],
      timeframe: "5m",
      riskProfile: "LOW",
      parameters: {},
    },
    {
      symbol: "AAPL",
      direction: "BUY",
      quantity: 1,
      type: "MARKET",
      mode: "PAPER",
      confirmed: true,
      clientOrderId: "once",
    },
    {
      requestedCapital: 226.5,
      expectedPrice: 226.5,
      stopLoss: 220,
      dailyProfitLoss: 0,
      tradesToday: 0,
      concurrentPositions: 0,
      portfolioExposure: 0,
      autoTraderExposure: 0,
      assetExposure: 0,
      portfolioValue: 100000,
      portfolioDrawdownPct: 0,
      source: "AUTO_TRADER",
      emergencyStopActive: false,
      systemLocked: false,
    },
  );
  assert.deepEqual(events, [
    "market",
    "strategy",
    "risk",
    "permission",
    "broker",
  ]);
});
test("order endpoint prevents duplicates before broker submission", async () => {
  const route = await readFile(
    new URL("../app/api/broker/orders/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /clientOrderId/);
  assert.match(route, /Duplicate request safely returned/);
  assert.ok(
    route.indexOf("existing") < route.indexOf("queueBroker.submitPaperOrder"),
  );
});
test("market data synchronization state is owner scoped by RLS", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608130004_trade_005_market_data.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /market_data_sync_state enable row level security/);
  assert.match(migration, /auth\.uid\(\) = user_id/g);
  assert.match(migration, /orders_owner_client_order_idx/);
});
