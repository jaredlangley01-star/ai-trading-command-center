import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IBKRBrokerService } from "../src/services/broker/ibkr-broker-service.ts";
import { BrokerError } from "../src/services/broker/errors.ts";
import { PaperOrderService } from "../src/services/broker/paper-order-service.ts";
import { TradePermissionService } from "../src/services/trade-permission.ts";

const settings = {
  autoTraderEnabled: true,
  autoTraderAllocatedCapital: 25000,
  maximumCapitalPerTrade: 2500,
  maximumRiskPerTrade: 250,
  dailyMaximumLoss: 750,
  dailyProfitTarget: 1000,
  maximumTradesPerDay: 8,
  maximumConcurrentPositions: 4,
  maximumPortfolioDrawdown: 12,
  maximumExposurePerAsset: 20,
  bigMoneyApprovalThreshold: 85,
};
const state = (extra = {}) => ({
  mode: "PAPER",
  autoTraderStatus: "ACTIVE",
  riskState: "NORMAL",
  emergencyStopActive: false,
  ...extra,
});
const order = (extra = {}) => ({
  symbol: "AAPL",
  direction: "BUY",
  quantity: 1,
  type: "MARKET",
  mode: "PAPER",
  confirmed: true,
  ...extra,
});
test("IBKR adapter is paper-only and rejects live configuration", () => {
  assert.throws(
    () =>
      new IBKRBrokerService({
        environment: "LIVE",
        baseUrl: "https://localhost:5000/v1/api",
        timeoutMs: 10,
      }),
    (e) => e instanceof BrokerError && e.code === "LIVE_TRADING_LOCKED",
  );
});
test("live order requests are rejected before broker calls", async () => {
  let calls = 0;
  const broker = {
    submitPaperOrder: async () => {
      calls++;
      return { status: "SUBMITTED", message: "", mode: "PAPER" };
    },
    getAccountSummary: async () => {},
    getPositions: async () => [],
    getOrders: async () => [],
    getExecutions: async () => [],
    cancelPaperOrder: async () => {},
  };
  const service = new PaperOrderService(
    broker,
    { refresh: async () => {} },
    new TradePermissionService(state(), settings),
  );
  await assert.rejects(
    service.submit(order({ mode: "LIVE" })),
    (e) => e.code === "LIVE_TRADING_LOCKED",
  );
  assert.equal(calls, 0);
});
test("confirmation and emergency stop block paper orders", async () => {
  let calls = 0,
    riskCalls = 0;
  const broker = {
    submitPaperOrder: async () => {
      calls++;
      return { status: "SUBMITTED", message: "", mode: "PAPER" };
    },
    getAccountSummary: async () => {},
    getPositions: async () => [],
    getOrders: async () => [],
    getExecutions: async () => [],
    cancelPaperOrder: async () => {},
  };
  const normal = new PaperOrderService(
    broker,
    {
      refresh: async () => {
        riskCalls++;
      },
    },
    new TradePermissionService(state(), settings),
  );
  await assert.rejects(
    normal.submit(order({ confirmed: false })),
    (e) => e.code === "PAPER_CONFIRMATION_REQUIRED",
  );
  const locked = new PaperOrderService(
    broker,
    {
      refresh: async () => {
        riskCalls++;
      },
    },
    new TradePermissionService(
      state({
        emergencyStopActive: true,
        riskState: "LOCKED",
        autoTraderStatus: "LOCKED",
      }),
      settings,
    ),
  );
  await assert.rejects(
    locked.submit(order()),
    (e) => e.code === "TRADE_PERMISSION_DENIED",
  );
  assert.equal(calls, 0);
  assert.equal(riskCalls, 0);
});
test("approved paper order flows through permission then risk then broker", async () => {
  const events = [];
  const broker = {
    submitPaperOrder: async () => {
      events.push("broker");
      return { status: "SUBMITTED", message: "paper", mode: "PAPER" };
    },
    getAccountSummary: async () => {},
    getPositions: async () => [],
    getOrders: async () => [],
    getExecutions: async () => [],
    cancelPaperOrder: async () => {},
  };
  const service = new PaperOrderService(
    broker,
    { refresh: async () => events.push("risk") },
    new TradePermissionService(state(), settings),
  );
  await service.submit(order());
  assert.deepEqual(events, ["risk", "broker"]);
});
test("disconnected configuration and errors preserve demo fallback", async () => {
  const source = await readFile(
    new URL("../src/services/broker/dashboard.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /source:\s*"DEMO"/);
  assert.match(source, /catch/);
  assert.match(source, /AWAITING_SETUP/);
});
test("broker credentials and account identifiers are not exposed client-side", async () => {
  const [client, env] = await Promise.all([
    readFile(
      new URL("../components/trading-command-center.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(
    client,
    /IBKR_GATEWAY_URL|IBKR_(USERNAME|PASSWORD|TOKEN|ACCOUNT)|eyJ[a-zA-Z0-9_-]{10,}/,
  );
  assert.doesNotMatch(
    env,
    /eyJ[a-zA-Z0-9_-]{10,}|IBKR_(USERNAME|PASSWORD|TOKEN|ACCOUNT)/,
  );
});
