import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AlpacaMarketDataService } from "../src/services/market-data/alpaca-market-data-service.ts";
import { assertFreshMarketQuote } from "../src/services/market-data/freshness.ts";
import { AutoTraderEngine } from "../src/services/auto-trader.ts";

const asset = {
  id: "aapl",
  symbol: "AAPL",
  name: "Apple",
  assetClass: "EQUITY",
  currency: "USD",
};
const config = {
  apiKey: "server-test-key",
  apiSecret: "server-test-secret",
  feed: "iex",
  dataUrl: "https://fixture.alpaca.test",
  cacheMs: 1,
};

test("Alpaca IEX quote normalization preserves quote, trade and source", async () => {
  const service = new AlpacaMarketDataService(config, async (url, init) => {
    assert.match(String(url), /snapshots.*feed=iex/);
    assert.equal(init.headers["APCA-API-KEY-ID"], "server-test-key");
    return new Response(
      JSON.stringify({
        AAPL: {
          latestQuote: { bp: 226.1, ap: 226.3, t: "2026-08-14T10:00:00Z" },
          latestTrade: { p: 226.2, t: "2026-08-14T10:00:01Z" },
        },
      }),
    );
  });
  const quote = await service.getQuote(asset);
  assert.deepEqual([quote.bid, quote.ask, quote.last], [226.1, 226.3, 226.2]);
  assert.equal(quote.source, "ALPACA_IEX");
  assert.equal(quote.provider, "ALPACA");
  assert.equal(quote.feed, "IEX");
  assert.equal(quote.isDemo, false);
});

test("Alpaca historical IEX candles normalize OHLC and volume", async () => {
  const service = new AlpacaMarketDataService(
    { ...config, dataUrl: "https://history.alpaca.test" },
    async (url) => {
      assert.match(String(url), /bars\?feed=iex&timeframe=1Day/);
      return new Response(
        JSON.stringify({
          bars: [
            {
              t: "2026-08-13T00:00:00Z",
              o: 220,
              h: 228,
              l: 219,
              c: 226,
              v: 12345,
            },
          ],
        }),
      );
    },
  );
  const candles = await service.getHistoricalCandles(asset, "1 M", "1 day");
  assert.deepEqual(candles[0], {
    time: "2026-08-13T00:00:00Z",
    open: 220,
    high: 228,
    low: 219,
    close: 226,
    volume: 12345,
  });
});

test("stale and disconnected market data block new entries", () => {
  assert.throws(() => assertFreshMarketQuote(null), /MARKET_DATA_DISCONNECTED/);
  assert.throws(
    () =>
      assertFreshMarketQuote(
        {
          assetId: "aapl",
          bid: 1,
          ask: 2,
          last: 1.5,
          asOf: "2026-08-14T09:00:00Z",
          source: "ALPACA_IEX",
          isDemo: false,
          isDelayed: false,
          provider: "ALPACA",
          feed: "IEX",
        },
        Date.parse("2026-08-14T10:00:00Z"),
        30_000,
      ),
    /STALE_MARKET_DATA/,
  );
});

test("Alpaca is market-data-only and credentials remain server-side", async () => {
  const [service, client, env, autoRoute] = await Promise.all([
    readFile(
      new URL(
        "../src/services/market-data/alpaca-market-data-service.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../components/trading-command-center.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/auto-trader/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(service, /submitPaperOrder|placeOrder|cancelOrder/);
  assert.doesNotMatch(client, /ALPACA_API_KEY|ALPACA_API_SECRET/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_ALPACA/);
  assert.match(autoRoute, /GuardedPaperBrokerService/);
  assert.match(autoRoute, /createPaperBroker/);
});

test("dashboard centrally polls market data without page refresh", async () => {
  const client = await readFile(
    new URL("../components/trading-command-center.tsx", import.meta.url),
    "utf8",
  );
  assert.match(client, /fetch\(\s*"\/api\/market-data/);
  assert.match(client, /setInterval\(refresh, 5000\)/);
  assert.match(client, /ALPACA|liveMarket\.source/);
  assert.match(client, /MARKET DATA DISCONNECTED/);
});

test("Auto Trader rejects stale data before any PAPER broker call", async () => {
  let brokerCalls = 0;
  const result = await new AutoTraderEngine(
    {
      evaluate: async () => ({
        symbol: "AAPL",
        supportingStrategies: ["Momentum"],
        conflictingStrategies: [],
        combinedScore: 90,
        finalRecommendation: "BUY",
        signals: [],
        timestamp: new Date().toISOString(),
        dataSource: "ALPACA — IEX",
        marketDataTimestamp: "2020-01-01T00:00:00Z",
        marketAnalysis: null,
      }),
    },
    { refresh: async () => {} },
    { canTradeAutomatically: () => true },
    {
      submitPaperOrder: async () => {
        brokerCalls += 1;
      },
    },
    "IBKR_PAPER",
    {
      enabled: true,
      minimumStrategyScore: 70,
      allowedAssets: ["AAPL"],
      allowedStrategies: ["Momentum"],
      maximumTradeSize: 1000,
      capitalAllocation: 1000,
    },
    {
      record: async () => {},
      claimOpportunity: async () => true,
      buildRiskContext: async () => ({}),
    },
  ).run(asset);
  assert.equal(result.reason, "STALE_MARKET_DATA");
  assert.equal(result.executionSource, "NONE");
  assert.equal(brokerCalls, 0);
});

test("market data failure does not contain position-closing behavior", async () => {
  const [freshness, route] = await Promise.all([
    readFile(
      new URL("../src/services/market-data/freshness.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/market-data/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(
    `${freshness}\n${route}`,
    /closePosition|liquidate|cancelPaperOrder/,
  );
});
