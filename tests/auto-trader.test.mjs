import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AutoTraderEngine } from "../src/services/auto-trader.ts";
import { SimulatedPaperBrokerService } from "../src/services/broker/simulated-paper-broker-service.ts";
import { GuardedPaperBrokerService } from "../src/services/broker/guarded-paper-broker-service.ts";
import { TradePermissionService } from "../src/services/trade-permission.ts";
import {
  defaultAutoTraderConfig,
  defaultRiskSettings,
} from "../src/config/trading.ts";

const asset = {
  id: "nvda",
  symbol: "NVDA",
  name: "NVIDIA",
  assetClass: "EQUITY",
  currency: "USD",
};
const opportunity = (overrides = {}) => ({
  symbol: "NVDA",
  supportingStrategies: ["Momentum", "Breakout"],
  conflictingStrategies: [],
  combinedScore: 84,
  finalRecommendation: "BUY",
  timestamp: "2026-08-14T10:15:00Z",
  dataSource: "DEMO DATA",
  marketAnalysis: {
    bid: 99.9,
    ask: 100.1,
    last: 100,
    volatility: 20,
    trend: "UP",
    momentum: 3,
  },
  signals: [
    {
      symbol: "NVDA",
      direction: "BUY",
      strategyName: "Momentum",
      score: 84,
      entrySuggestion: 100,
      stopLossSuggestion: 95,
      takeProfitSuggestion: 110,
      riskReward: 2,
      reasoning: "Strong controlled momentum",
      timestamp: "2026-08-14T10:15:00Z",
    },
  ],
  ...overrides,
});
const state = (overrides = {}) => ({
  mode: "PAPER",
  autoTraderStatus: "ACTIVE",
  riskState: "NORMAL",
  emergencyStopActive: false,
  ...overrides,
});
const riskContext = (order) => ({
  requestedCapital: order.quantity * order.limitPrice,
  expectedPrice: order.limitPrice,
  stopLoss: order.stopLoss,
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
});
const build = ({
  result = opportunity(),
  config = {},
  system = {},
  claim = true,
  riskDecision = {
    status: "APPROVED",
    reason: "RISK_CHECKS_PASSED",
    approvedCapital: 2500,
    requestedCapital: 2500,
    calculatedLoss: 125,
  },
  source = "SIMULATED_PAPER",
  broker = new SimulatedPaperBrokerService(),
} = {}) => {
  const recorded = [];
  const engine = new AutoTraderEngine(
    { evaluate: async () => result },
    { refresh: async () => {}, evaluateOrder: async () => riskDecision },
    new TradePermissionService(state(system), {
      ...defaultRiskSettings,
      autoTraderEnabled: true,
    }),
    broker,
    source,
    { ...defaultAutoTraderConfig, enabled: true, ...config },
    {
      claimOpportunity: async () => claim,
      buildRiskContext: async (order) => riskContext(order),
      record: async (decision) => recorded.push(decision),
    },
  );
  return { engine, recorded };
};

test("eligible Auto Trader opportunity executes as clearly simulated PAPER", async () => {
  const { engine, recorded } = build();
  const result = await engine.run(asset);
  assert.equal(result.status, "EXECUTED");
  assert.equal(result.executionSource, "SIMULATED_PAPER");
  assert.equal(result.reason, "SIMULATED_PAPER_EXECUTION");
  assert.equal(recorded.length, 1);
});
test("paused and Emergency Stop states cannot execute", async () => {
  assert.equal(
    (await build({ config: { enabled: false } }).engine.run(asset)).status,
    "LOCKED",
  );
  assert.equal(
    (
      await build({
        system: { emergencyStopActive: true, autoTraderStatus: "LOCKED" },
      }).engine.run(asset)
    ).status,
    "LOCKED",
  );
});
test("daily loss and profit risk locks prevent automated execution", async () => {
  for (const reason of [
    "DAILY_LOSS_LIMIT_REACHED",
    "DAILY_PROFIT_TARGET_REACHED",
  ]) {
    const result = await build({
      riskDecision: {
        status: "DAILY_LOCK",
        reason,
        approvedCapital: 0,
        requestedCapital: 2500,
        calculatedLoss: 125,
      },
    }).engine.run(asset);
    assert.equal(result.status, "LOCKED");
    assert.match(result.reason, new RegExp(reason));
  }
});
test("invalid stop-loss and take-profit reject before broker access", async () => {
  let calls = 0;
  const broker = {
    ...new SimulatedPaperBrokerService(),
    submitPaperOrder: async () => {
      calls++;
      throw new Error("must not run");
    },
  };
  const badStop = opportunity({
    signals: [{ ...opportunity().signals[0], stopLossSuggestion: 105 }],
  });
  const badTarget = opportunity({
    signals: [{ ...opportunity().signals[0], takeProfitSuggestion: 90 }],
  });
  assert.equal(
    (await build({ result: badStop, broker }).engine.run(asset)).reason,
    "INVALID_STOP_LOSS",
  );
  assert.equal(
    (await build({ result: badTarget, broker }).engine.run(asset)).reason,
    "INVALID_TAKE_PROFIT",
  );
  assert.equal(calls, 0);
});
test("durable duplicate claim prevents a second execution", async () => {
  let calls = 0;
  const simulated = new SimulatedPaperBrokerService();
  const broker = {
    getAccountSummary: () => simulated.getAccountSummary(),
    getPositions: () => simulated.getPositions(),
    getOrders: () => simulated.getOrders(),
    getExecutions: () => simulated.getExecutions(),
    cancelPaperOrder: (id) => simulated.cancelPaperOrder(id),
    submitPaperOrder: async (order) => {
      calls++;
      return simulated.submitPaperOrder(order);
    },
  };
  const result = await build({ claim: false, broker }).engine.run(asset);
  assert.equal(result.reason, "DUPLICATE_OPPORTUNITY");
  assert.equal(calls, 0);
});
test("last-moment guarded broker blocks queued work after Emergency Stop", async () => {
  let calls = 0;
  const simulated = new SimulatedPaperBrokerService();
  const guarded = new GuardedPaperBrokerService(
    {
      getAccountSummary: () => simulated.getAccountSummary(),
      getPositions: () => simulated.getPositions(),
      getOrders: () => simulated.getOrders(),
      getExecutions: () => simulated.getExecutions(),
      cancelPaperOrder: (id) => simulated.cancelPaperOrder(id),
      submitPaperOrder: async (order) => {
        calls++;
        return simulated.submitPaperOrder(order);
      },
    },
    async () => false,
  );
  const result = await build({ broker: guarded }).engine.run(asset);
  assert.equal(result.status, "REJECTED");
  assert.equal(calls, 0);
});
test("migration provides owner-scoped state and durable idempotency", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/202608140001_trade_008_auto_trader.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /unique \(user_id, opportunity_key\)/);
  assert.match(sql, /automated_executions/);
  assert.match(sql, /journal_entries add column/);
  assert.ok((sql.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 8);
});
test("Auto Trader server flow contains both risk and permission gates and no LIVE path", async () => {
  const [service, route, css] = await Promise.all([
    readFile(
      new URL("../src/services/auto-trader.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/auto-trader/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(service, /PaperOrderService/);
  assert.match(service, /TradePermissionService/);
  assert.match(service, /mode:\s*"PAPER"/);
  assert.doesNotMatch(service + route, /mode:\s*"LIVE"|IBKR_TWS_PORT=4001/);
  assert.match(css, /@media \(min-width: 801px\)/);
  assert.doesNotMatch(css, /zoom:\s*1\.2/);
});
test("mobile critical Auto Trader controls remain responsive and available", async () => {
  const [ui, css] = await Promise.all([
    readFile(
      new URL("../components/trading-command-center.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /ENABLE AUTO TRADER/);
  assert.match(ui, /PAUSE AUTO TRADER/);
  assert.match(ui, /RUN PAPER CYCLE/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.auto-actions/);
  assert.match(ui, /RESET EMERGENCY STOP/);
});
test("daily locks leave existing positions visible and manageable", async () => {
  const [service, ui] = await Promise.all([
    readFile(
      new URL("../src/services/auto-trader.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/trading-command-center.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(service, /closePosition|deletePosition|liquidate/i);
  assert.match(ui, /EXISTING POSITIONS REMAIN MANAGEABLE/);
});
