import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canOpenIntradayEntry,
  dayTraderSession,
  evaluateIntradayExit,
  isOvernightViolation,
} from "../src/services/intraday-lifecycle.ts";
import {
  calculateStrategyAnalytics,
  livePaperStrategyPerformance,
  strategyHealth,
} from "../src/services/strategy-analytics.ts";
import { toCsv } from "../src/services/csv-export.ts";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const schedule = {
  timezone: "America/New_York",
  sessionStart: "09:30",
  sessionEnd: "16:00",
  entryStart: "09:35",
  lastEntryTime: "15:15",
  forceExitTime: "15:50",
  maxHoldMinutes: 120,
  minimumExitScore: 45,
};

test("Auto Trader entries obey timezone-aware entry start and cutoff", () => {
  assert.equal(
    canOpenIntradayEntry(new Date("2026-08-20T13:34:00Z"), schedule),
    false,
  );
  assert.equal(
    canOpenIntradayEntry(new Date("2026-08-20T13:35:00Z"), schedule),
    true,
  );
  assert.equal(
    canOpenIntradayEntry(new Date("2026-08-20T19:15:00Z"), schedule),
    false,
  );
});

test("force-exit window closes Auto Trader positions before end of session", () => {
  const now = new Date("2026-08-20T19:50:00Z");
  assert.equal(dayTraderSession(now, schedule), "CLOSING");
  assert.equal(
    evaluateIntradayExit({ now, openedAt: "2026-08-20T15:00:00Z", schedule }),
    "END_OF_SESSION",
  );
});

test("Auto Trader overnight violation is detected while Big Money is exempt in worker", () => {
  assert.equal(
    isOvernightViolation(
      "2026-08-19T14:00:00Z",
      new Date("2026-08-20T14:00:00Z"),
      schedule.timezone,
    ),
    true,
  );
  const worker = read("hosted-worker/index.mjs");
  assert.match(worker, /tradeOrigin === "AUTO_TRADER"/);
  assert.doesNotMatch(worker, /tradeOrigin === "BIG_MONEY" && autoConfig/);
});

test("signal weakening, reversal, invalidation and max hold create typed exits", () => {
  const now = new Date("2026-08-20T16:00:00Z");
  const base = { now, openedAt: "2026-08-20T15:00:00Z", schedule };
  assert.equal(
    evaluateIntradayExit({ ...base, currentScore: 40 }),
    "SIGNAL_WEAKENED",
  );
  assert.equal(
    evaluateIntradayExit({
      ...base,
      originalDirection: "BUY",
      currentDirection: "SELL",
    }),
    "SIGNAL_REVERSED",
  );
  assert.equal(
    evaluateIntradayExit({ ...base, strategyValid: false }),
    "STRATEGY_INVALIDATED",
  );
  assert.equal(
    evaluateIntradayExit({ ...base, openedAt: "2026-08-20T13:00:00Z" }),
    "MAX_HOLD_TIME",
  );
});

test("stop, target, risk and emergency exits retain priority", () => {
  const base = {
    now: new Date("2026-08-20T16:00:00Z"),
    openedAt: "2026-08-20T15:30:00Z",
    schedule,
  };
  assert.equal(
    evaluateIntradayExit({ ...base, stopTriggered: true }),
    "STOP_LOSS",
  );
  assert.equal(
    evaluateIntradayExit({ ...base, targetTriggered: true }),
    "TAKE_PROFIT",
  );
  assert.equal(evaluateIntradayExit({ ...base, riskExit: true }), "RISK_EXIT");
  assert.equal(
    evaluateIntradayExit({ ...base, emergencyStop: true }),
    "EMERGENCY_EXIT",
  );
});

test("protection audit persists planned and worker-monitored protection and alerts", () => {
  const migration = read(
    "supabase/migrations/202608200001_trade_017_intraday_trader.sql",
  );
  const worker = read("hosted-worker/index.mjs");
  assert.match(migration, /protection_status.*UNPROTECTED/);
  assert.match(migration, /WORKER_MONITORED/);
  assert.match(worker, /PROTECTIVE_EXIT_FAILURE/);
  assert.match(worker, /severity: "CRITICAL"/);
  assert.match(worker, /plannedStop/);
});

test("strategy analytics calculate P&L, profit factor, expectancy, drawdown, duration and exit frequencies", () => {
  const trades = [
    {
      net_pl: 100,
      entry_timestamp: "2026-08-20T14:00:00Z",
      exit_timestamp: "2026-08-20T15:00:00Z",
      exit_reason: "TAKE_PROFIT",
    },
    {
      net_pl: -50,
      entry_timestamp: "2026-08-20T15:00:00Z",
      exit_timestamp: "2026-08-20T15:30:00Z",
      exit_reason: "STOP_LOSS",
    },
    {
      net_pl: 25,
      entry_timestamp: "2026-08-20T16:00:00Z",
      exit_timestamp: "2026-08-20T16:15:00Z",
      exit_reason: "END_OF_SESSION",
    },
  ];
  const metrics = calculateStrategyAnalytics(trades, 2);
  assert.equal(metrics.completed, 3);
  assert.equal(metrics.totalRealizedPl, 75);
  assert.equal(metrics.profitFactor, 2.5);
  assert.equal(metrics.expectancy, 25);
  assert.equal(metrics.maxDrawdown, 50);
  assert.equal(metrics.averageDurationMinutes, 35);
  assert.ok(
    metrics.stopLossFrequency > 0 &&
      metrics.takeProfitFrequency > 0 &&
      metrics.endOfSessionExitFrequency > 0,
  );
});

test("strategy health respects configurable sample size", () => {
  assert.equal(
    strategyHealth(
      { completed: 19, totalRealizedPl: 999, profitFactor: 4, expectancy: 20 },
      20,
    ),
    "NOT ENOUGH DATA",
  );
  assert.equal(
    strategyHealth(
      {
        completed: 25,
        totalRealizedPl: 500,
        profitFactor: 1.5,
        expectancy: 20,
      },
      20,
    ),
    "HEALTHY",
  );
  assert.equal(
    strategyHealth(
      {
        completed: 25,
        totalRealizedPl: -500,
        profitFactor: 0.5,
        expectancy: -20,
      },
      20,
    ),
    "PAUSE RECOMMENDED",
  );
});

test("live PAPER strategy performance excludes Big Money and backtests", () => {
  const result = livePaperStrategyPerformance([
    {
      strategy_name: "Momentum",
      trade_origin: "AUTO_TRADER",
      environment: "PAPER",
      net_pl: 10,
      entry_timestamp: "2026-08-20T14:00:00Z",
      exit_timestamp: "2026-08-20T15:00:00Z",
    },
    {
      strategy_name: "Momentum",
      trade_origin: "BIG_MONEY",
      environment: "PAPER",
      net_pl: 1000,
      entry_timestamp: "2026-08-19T14:00:00Z",
      exit_timestamp: "2026-08-20T15:00:00Z",
    },
  ]);
  assert.equal(result.Momentum.completed, 1);
  assert.equal(result.Momentum.totalRealizedPl, 10);
});

test("CSV escapes formulas and exports only selected safe columns", () => {
  const csv = toCsv(
    [
      { key: "symbol", label: "symbol" },
      { key: "status", label: "status" },
    ],
    [{ symbol: "=CMD()", status: "PAPER", secret: "never" }],
  );
  assert.match(csv, /'=CMD\(\)/);
  assert.doesNotMatch(csv, /never|API_KEY|SERVICE_ROLE/);
  const route = read("app/api/exports/[kind]/route.ts");
  assert.doesNotMatch(route, /api_secret|service_role|VAPID_PRIVATE/);
});

test("Trader uses structured owner-scoped context and is read-only for trading", () => {
  const route = read("app/api/trader/route.ts");
  assert.match(route, /verifiedSystemContext/);
  assert.match(route, /READ_ONLY_ACTION/);
  assert.doesNotMatch(
    route,
    /submitPaperOrder|createPaperBroker|BrokerService|\/v2\/orders/,
  );
  assert.match(route, /liveLocked: true/);
});

test("Trader AI unavailable fallback preserves deterministic trading services", () => {
  const route = read("app/api/trader/route.ts");
  const ui = read("components/trader-assistant.tsx");
  assert.match(route, /deterministicReply/);
  assert.match(
    route,
    /Boolean\(process\.env\.AI_API_KEY && process\.env\.AI_MODEL\)/,
  );
  assert.match(ui, /AI UNAVAILABLE · DETERMINISTIC DATA/);
});

test("strategy proposals stay DRAFT until explicit later workflow", () => {
  const route = read("app/api/trader/route.ts");
  const migration = read(
    "supabase/migrations/202608200001_trade_017_intraday_trader.sql",
  );
  assert.match(route, /status: "DRAFT"/);
  assert.match(
    migration,
    /DRAFT','BACKTESTING','REVIEW','APPROVED','ACTIVE','REJECTED/,
  );
  assert.doesNotMatch(route, /status: "ACTIVE"/);
});

test("proactive Trader worker is hosted, deduplicated, cooled down and broker-free", () => {
  const worker = read("hosted-worker/trader-worker.mjs");
  const pkg = read("package.json");
  assert.match(worker, /HOSTED_PRODUCTION_REQUIRED/);
  assert.match(worker, /cooldownMs/);
  assert.match(worker, /dedupe_key/);
  assert.match(worker, /liveLocked: true/);
  assert.doesNotMatch(worker, /alpaca|Broker|submitPaperOrder|\/v2\/orders/i);
  assert.match(pkg, /worker:trader/);
});

test("Trader context links never approve or execute", () => {
  const ui = read("components/trader-assistant.tsx");
  const route = read("app/api/trader/route.ts");
  assert.match(route, /OPEN PORTFOLIO/);
  assert.match(route, /RUN BACKTEST/);
  assert.match(route, /REVIEW BIG MONEY OPPORTUNITY/);
  assert.doesNotMatch(ui, /APPROVE TRADE|SUBMIT ORDER/);
});

test("LIVE remains locked and Railway worker ESM imports remain explicit", () => {
  const trading = read("hosted-worker/index.mjs");
  const trader = read("hosted-worker/trader-worker.mjs");
  assert.match(trading, /LIVE_TRADING_LOCKED/);
  assert.match(trading, /intraday-lifecycle\.ts/);
  assert.match(trader, /strategy-analytics\.ts/);
  assert.doesNotMatch(trader, /\.\.\/src\/[^"']+(?<!\.ts)["']/);
});
