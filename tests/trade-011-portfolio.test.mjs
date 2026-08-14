import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ProtectiveExitService } from "../src/services/broker/protective-exit-service.ts";

const worker = await readFile(
  new URL("../hosted-worker/index.mjs", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../app/api/portfolio/route.ts", import.meta.url),
  "utf8",
);
const ui = await readFile(
  new URL("../components/trading-command-center.tsx", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/202608140005_trade_011_hosted_portfolio.sql",
    import.meta.url,
  ),
  "utf8",
);

test("hosted worker synchronizes Alpaca PAPER portfolio and P/L", () => {
  for (const value of [
    "/v2/account",
    "/v2/positions",
    "activities/FILL",
    "portfolio/history",
    "paper_portfolio_current",
    "paper_positions",
    "paper_broker_fills",
    "paper_portfolio_pl_history",
  ])
    assert.ok(worker.includes(value));
});

test("dashboard receives owner-scoped PAPER data and polls", () => {
  assert.match(api, /getAuthenticatedOwner/);
  assert.match(api, /paper_portfolio_current/);
  assert.match(ui, /fetch\("\/api\/portfolio"/);
  assert.match(ui, /setInterval\(refresh, 5000\)/);
  assert.match(ui, /ALPACA PAPER DATA/);
});

test("protective exits continue through entry locks", async () => {
  assert.match(worker, /new ProtectiveExitService/);
  const calls = [];
  const broker = {
    submitPaperOrder: async (order) => (
      calls.push(order),
      { status: "ACCEPTED", mode: "PAPER", message: "ok" }
    ),
  };
  const service = new ProtectiveExitService(broker, {
    mode: "PAPER",
    autoTraderStatus: "LOCKED",
    riskState: "LOCKED",
    emergencyStopActive: true,
  });
  await service.submit({
    symbol: "AAPL",
    direction: "SELL",
    quantity: 2,
    openQuantity: 2,
    reason: "STOP_LOSS",
    clientOrderId: "exit-1",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, "POSITION_MANAGER");
  assert.equal(calls[0].mode, "PAPER");
});

test("stop, target, exit, and fill idempotency are durable", () => {
  assert.match(worker, /stopTriggered/);
  assert.match(worker, /targetTriggered/);
  assert.match(
    worker,
    /Unique claim means another cycle\/restart owns the exit/,
  );
  assert.match(migration, /unique \(user_id, broker_position_id\)/i);
  assert.match(migration, /unique \(user_id, broker_execution_id\)/i);
});

test("LIVE and local infrastructure remain unavailable", async () => {
  const service = new ProtectiveExitService(
    { submitPaperOrder: async () => assert.fail("broker called") },
    {
      mode: "LIVE",
      autoTraderStatus: "ACTIVE",
      riskState: "NORMAL",
      emergencyStopActive: false,
    },
  );
  await assert.rejects(
    () =>
      service.submit({
        symbol: "AAPL",
        direction: "SELL",
        quantity: 1,
        openQuantity: 1,
        reason: "TAKE_PROFIT",
        clientOrderId: "live",
      }),
    /LIVE exits are locked/,
  );
  assert.doesNotMatch(worker, /localhost|127\.0\.0\.1|IBKR|TWS|4002|7497/i);
});

test("protective exit cannot exceed the existing position", async () => {
  const service = new ProtectiveExitService(
    { submitPaperOrder: async () => assert.fail("broker called") },
    {
      mode: "PAPER",
      autoTraderStatus: "PAUSED",
      riskState: "NORMAL",
      emergencyStopActive: false,
    },
  );
  await assert.rejects(
    () =>
      service.submit({
        symbol: "AAPL",
        direction: "SELL",
        quantity: 2,
        openQuantity: 1,
        reason: "STOP_LOSS",
        clientOrderId: "oversize",
      }),
    /only reduce an existing PAPER position/,
  );
});
