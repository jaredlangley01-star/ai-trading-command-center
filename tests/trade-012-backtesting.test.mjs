import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchAlpacaHistoricalBars } from "../src/services/backtesting/historical-data.ts";
import { runHistoricalBacktest } from "../src/services/backtesting/engine.ts";

const rising = (count = 90) =>
  Array.from({ length: count }, (_, index) => ({
    time: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
    open: 100 + index,
    high: 101.5 + index,
    low: 99.5 + index,
    close: 101 + index,
    volume: 1000 + index * 20,
  }));
const config = {
  strategy: "Momentum",
  symbol: "AAPL",
  start: "2025-01-01",
  end: "2025-04-01",
  timeframe: "1Day",
  startingCapital: 100000,
  riskProfile: "Recommended",
  positionSizePct: 10,
  stopLossPct: 2,
  takeProfitPct: 4,
  maximumConcurrentPositions: 1,
  slippageBps: 5,
  commissionPerTrade: 1,
};

test("Alpaca historical OHLCV normalization supports every timeframe", async () => {
  const originalKey = process.env.ALPACA_API_KEY,
    originalSecret = process.env.ALPACA_API_SECRET;
  process.env.ALPACA_API_KEY = "test";
  process.env.ALPACA_API_SECRET = "test";
  for (const timeframe of ["1Min", "5Min", "15Min", "1Hour", "1Day"]) {
    let requested = "";
    const bars = await fetchAlpacaHistoricalBars(
      "aapl",
      config.start,
      config.end,
      timeframe,
      async (url) => {
        requested = String(url);
        return new Response(
          JSON.stringify({
            bars: [
              { t: "2025-01-02T00:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 100 },
            ],
          }),
          { status: 200 },
        );
      },
    );
    assert.match(requested, new RegExp(`timeframe=${timeframe}`));
    assert.deepEqual(bars[0], {
      time: "2025-01-02T00:00:00Z",
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 100,
    });
  }
  process.env.ALPACA_API_KEY = originalKey;
  process.env.ALPACA_API_SECRET = originalSecret;
});

test("signals enter on the next bar and account for slippage and fees", () => {
  const bars = rising();
  const result = runHistoricalBacktest(config, bars);
  assert.ok(result.trades.length > 0);
  const trade = result.trades[0];
  const entryIndex = bars.findIndex((bar) => bar.time === trade.entryTimestamp);
  assert.ok(entryIndex > 30);
  assert.ok(trade.entryPrice > bars[entryIndex].open);
  assert.equal(trade.costs, 2);
  assert.notEqual(trade.grossPl, trade.netPl);
});

test("stop and target behavior are deterministic and conservative", () => {
  const result = runHistoricalBacktest(
    { ...config, stopLossPct: 1, takeProfitPct: 1 },
    rising(),
  );
  assert.ok(
    result.trades.some((trade) =>
      ["STOP_LOSS", "TAKE_PROFIT"].includes(trade.exitReason),
    ),
  );
  assert.equal(
    result.assumptions.stopTargetCollision,
    "STOP_FIRST_CONSERVATIVE",
  );
});

test("LONG and SHORT capital, drawdown, win rate, profit factor, and Sharpe are finite", () => {
  const down = rising().map((bar, index) => ({
    ...bar,
    open: 200 - index,
    high: 201 - index,
    low: 198.5 - index,
    close: 199 - index,
  }));
  for (const bars of [rising(), down]) {
    const result = runHistoricalBacktest(config, bars);
    for (const key of [
      "endingCapital",
      "winRate",
      "profitFactor",
      "maximumDrawdown",
      "maximumDrawdownPct",
      "sharpeRatio",
      "expectancy",
    ])
      assert.ok(Number.isFinite(result.metrics[key]), key);
    assert.ok(result.equityCurve.length > 0);
    assert.equal(result.equityCurve.length, result.drawdownCurve.length);
  }
});

test("all real strategies and the production combiner are used", async () => {
  const engine = await readFile(
    new URL("../src/services/backtesting/engine.ts", import.meta.url),
    "utf8",
  );
  for (const value of [
    "MomentumStrategy",
    "BreakoutStrategy",
    "TrendFollowingStrategy",
    "MeanReversionStrategy",
    "combineStrategySignals",
    "defaultStrategies",
  ])
    assert.match(engine, new RegExp(value));
  assert.doesNotMatch(engine, /submitPaperOrder|BrokerService|\/v2\/orders/);
});

test("queued hosted persistence is owner scoped and restart safe", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608140006_trade_012_backtesting.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../app/api/backtests/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(migration, /Owners read own backtest trades/);
  assert.match(migration, /unique \(backtest_id, trade_index\)/i);
  assert.match(worker, /WORKER_RESTART_RECOVERY/);
  assert.match(worker, /eq\("status", "QUEUED"\)/);
  assert.match(api, /getAuthenticatedOwner/);
  assert.match(api, /status: "QUEUED"/);
  assert.doesNotMatch(
    worker.match(
      /async function processBacktestJob[\s\S]*?const researchUniverse/,
    )?.[0] ?? "",
    /PAPER_URL|submitPaperOrder/,
  );
});

test("hosted backtesting contains no local or LIVE execution dependency", async () => {
  const files = await Promise.all([
    readFile(
      new URL("../src/services/backtesting/engine.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/services/backtesting/historical-data.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/api/backtests/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(
    files.join("\n"),
    /localhost|127\.0\.0\.1|IBKR|TWS|LIVE order|submitPaperOrder/i,
  );
});
