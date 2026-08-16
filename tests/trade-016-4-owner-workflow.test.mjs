import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  activeTradeSummary,
  classifyTradeOrigin,
  journalSummary,
  newManualRequestId,
  projectPaperLifecycle,
  strategyPerformance,
} from "../src/services/paper-workflow.ts";

test("first-use tutorial supports launch skip completion replay reset and persistence", () => {
  const component = fs.readFileSync(
    new URL("../components/guided-tutorial.tsx", import.meta.url),
    "utf8",
  );
  const route = fs.readFileSync(
    new URL("../app/api/tutorial/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(component, /preferences\?\.auto_launch/);
  assert.match(component, /!preferences\.completed/);
  assert.match(component, /!preferences\.dismissed/);
  for (const action of ["DISMISS", "COMPLETE", "REPLAY", "RESET"])
    assert.ok(component.includes(action) || route.includes(action));
  assert.match(route, /owner_tutorial_preferences/);
  assert.match(route, /user_id: user\.id/);
  assert.match(component, /if \(!open\) return null/);
});

test("active trade totals use real capital and open P/L", () => {
  const result = activeTradeSummary([
    { trade_origin: "BIG_MONEY", market_value: 2500, unrealized_pl: 120 },
    { trade_origin: "AUTO_TRADER", market_value: -1000, unrealized_pl: -20 },
    { trade_origin: null, market_value: 750, unrealized_pl: 5 },
  ]);
  assert.deepEqual(result, {
    active: 3,
    big: 1,
    small: 1,
    standard: 1,
    capital: 4250,
    openPl: 105,
  });
});

test("BIG SMALL and STANDARD classification never guesses", () => {
  assert.equal(classifyTradeOrigin("BIG_MONEY"), "BIG");
  assert.equal(classifyTradeOrigin("AUTO_TRADER"), "SMALL");
  assert.equal(classifyTradeOrigin("MANUAL"), "STANDARD");
  assert.equal(classifyTradeOrigin("unknown"), "STANDARD");
  assert.equal(classifyTradeOrigin(null), "STANDARD");
});

test("journal aggregates and strategy performance use completed trades", () => {
  const trades = [
    { strategy_name: "Momentum", net_pl: 100, return_pct: 10 },
    { strategy_name: "Momentum", net_pl: -40, return_pct: -4 },
    { strategy_name: "Breakout", net_pl: 60, return_pct: 6 },
  ];
  assert.deepEqual(journalSummary(trades), {
    completed: 3,
    wins: 2,
    losses: 1,
    winRate: (2 / 3) * 100,
    totalRealizedPl: 120,
    averageWin: 80,
    averageLoss: -40,
    largestWin: 100,
    largestLoss: -40,
    averageReturn: 4,
  });
  assert.equal(strategyPerformance(trades).Momentum.completed, 2);
  assert.equal(strategyPerformance(trades).Momentum.totalRealizedPl, 60);
});

test("manual requests get a new ID while server retry remains idempotent", () => {
  const first = newManualRequestId();
  const second = newManualRequestId();
  assert.notEqual(first, second);
  const client = fs.readFileSync(
    new URL("../components/trading-command-center.tsx", import.meta.url),
    "utf8",
  );
  const route = fs.readFileSync(
    new URL("../app/api/broker/orders/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(client, /setClientOrderId\(newManualRequestId\(\)\)/);
  assert.match(client, /submitting\.current/);
  assert.match(route, /eq\("client_order_id", body\.clientOrderId\)/);
  assert.match(route, /Duplicate request safely returned/);
});

for (const [name, origin, classification] of [
  ["manual", "MANUAL", "STANDARD"],
  ["Auto Trader", "AUTO_TRADER", "SMALL"],
  ["Big Money", "BIG_MONEY", "BIG"],
])
  test(`full mock ${name} PAPER lifecycle links portfolio journal strategy and notifications`, () => {
    const lifecycle = projectPaperLifecycle({
      symbol: "AAPL",
      origin,
      strategy: name === "manual" ? "Manual" : "Momentum",
      direction: "LONG",
      quantity: 10,
      entryPrice: 100,
      exitPrice: 110,
    });
    assert.equal(lifecycle.acceptedOrder.mode, "PAPER");
    assert.equal(lifecycle.openPosition.trade_origin, origin);
    assert.equal(lifecycle.journal.classification, classification);
    assert.equal(lifecycle.journal.net_pl, 100);
    assert.equal(
      lifecycle.strategy[lifecycle.journal.strategy_name].totalRealizedPl,
      100,
    );
    assert.deepEqual(lifecycle.notifications, ["TRADE_OPENED", "TRADE_CLOSED"]);
  });

test("Portfolio Journal Strategies and activity read owner-scoped hosted state", () => {
  const portfolio = fs.readFileSync(
    new URL("../app/api/portfolio/route.ts", import.meta.url),
    "utf8",
  );
  const journal = fs.readFileSync(
    new URL("../app/api/journal/route.ts", import.meta.url),
    "utf8",
  );
  const strategies = fs.readFileSync(
    new URL("../app/api/strategy/performance/route.ts", import.meta.url),
    "utf8",
  );
  for (const source of [portfolio, journal, strategies]) {
    assert.match(source, /getAuthenticatedOwner/);
    assert.match(source, /\.eq\("user_id", user\.id\)/);
  }
  assert.match(portfolio, /paper_portfolio_current/);
  assert.match(portfolio, /paper_positions/);
  assert.match(portfolio, /paper_broker_fills/);
  assert.match(portfolio, /audit_events/);
  assert.match(journal, /completed_paper_trades/);
  assert.match(strategies, /strategy_signals/);
});

test("hosted UI contains no stale IBKR labels and no fake production trades", () => {
  const component = fs.readFileSync(
    new URL("../components/trading-command-center.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(component, /IBKR|TWS|Client Portal/);
  assert.match(component, /NO ACTIVE TRADES/);
  assert.match(component, /NO REAL PAPER ACTIVITY YET/);
});

test("notification worker heartbeats even when VAPID is not configured", () => {
  const worker = fs.readFileSync(
    new URL("../hosted-worker/notification-worker.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /pushConfigured/);
  assert.match(worker, /status: pushConfigured \? "ONLINE" : "ERROR"/);
  assert.match(worker, /VAPID_NOT_CONFIGURED/);
  assert.match(worker, /notification_worker_heartbeats/);
  assert.match(worker, /queueProcessing: true/);
});

test("TRADE-016.4 migration is owner scoped and records version last", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608160001_trade_016_4_owner_workflow.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /owner_tutorial_preferences/);
  assert.match(migration, /completed_paper_trades/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.ok(
    migration.lastIndexOf("insert into schema_migrations") >
      migration.lastIndexOf("create policy"),
  );
  assert.match(migration, /commit;\s*$/);
});
