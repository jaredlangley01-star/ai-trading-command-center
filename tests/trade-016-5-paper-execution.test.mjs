import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizePaperExecutionStatus,
  safePaperExecutionFailure,
} from "../src/services/paper-execution.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("hosted production manual PAPER orders route through a durable Railway queue", async () => {
  const [route, worker, migration] = await Promise.all([
    read("app/api/broker/orders/route.ts"),
    read("hosted-worker/index.mjs"),
    read(
      "supabase/migrations/202608160003_trade_016_5_paper_execution_queue.sql",
    ),
  ]);
  assert.match(route, /paper_execution_requests/);
  assert.match(route, /status: "QUEUED"/);
  assert.match(route, /heartbeatIsFresh/);
  assert.doesNotMatch(
    route,
    /createPaperBroker|ALPACA_PAPER_API_KEY|paper-api\.alpaca/,
  );
  assert.match(worker, /processManualExecutionRequests/);
  assert.match(worker, /paper-api\.alpaca\.markets/);
  assert.match(worker, /brokerHeaders\(\)/);
  assert.match(migration, /unique \(user_id, client_order_id\)/);
});

test("execution requests and Railway quotes are owner scoped without owner update access", async () => {
  const migration = await read(
    "supabase/migrations/202608160003_trade_016_5_paper_execution_queue.sql",
  );
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.match(migration, /for insert/);
  assert.match(migration, /for select/);
  assert.doesNotMatch(migration, /for update|for all/i);
  assert.match(migration, /source = 'MANUAL' and status = 'QUEUED'/);
  assert.ok(
    migration.lastIndexOf("202608160003_trade_016_5_paper_execution_queue") >
      migration.lastIndexOf("create policy"),
  );
  assert.match(migration, /on conflict \(version\) do nothing/);
});

test("duplicate submission is protected before durable queueing and at the database", async () => {
  const [route, migration, worker] = await Promise.all([
    read("app/api/broker/orders/route.ts"),
    read(
      "supabase/migrations/202608160003_trade_016_5_paper_execution_queue.sql",
    ),
    read("hosted-worker/index.mjs"),
  ]);
  assert.ok(route.indexOf("existing") < route.indexOf("queueBroker"));
  assert.match(migration, /unique \(user_id, client_order_id\)/);
  assert.match(worker, /\.eq\("status", "QUEUED"\)[\s\S]*?\.select\("id"\)/);
  assert.match(worker, /client_order_id: request\.client_order_id/);
  assert.match(worker, /orders:by_client_order_id/);
  assert.match(worker, /\.eq\("status", "SUBMITTING"\)/);
});

test("risk and permission reject before queue or broker execution", async () => {
  const [route, worker] = await Promise.all([
    read("app/api/broker/orders/route.ts"),
    read("hosted-worker/index.mjs"),
  ]);
  assert.ok(
    route.indexOf("riskManager.evaluateOrder") <
      route.indexOf("queueBroker.submitPaperOrder"),
  );
  assert.ok(
    route.indexOf("permission.canOpenTrade") <
      route.indexOf("queueBroker.submitPaperOrder"),
  );
  assert.match(worker, /riskDecision\?\.decision !== "APPROVED"/);
  assert.match(worker, /emergency_stop_active/);
});

test("worker unavailable and safe Alpaca failures have actionable categories", async () => {
  const route = await read("app/api/broker/orders/route.ts");
  assert.match(route, /WORKER_UNAVAILABLE/);
  assert.deepEqual(safePaperExecutionFailure(new Error("UPSTREAM_401")), {
    code: "BROKER_AUTH_FAILED",
    message: "Alpaca PAPER authentication failed.",
  });
  assert.deepEqual(safePaperExecutionFailure(new Error("UPSTREAM_422")), {
    code: "ORDER_REJECTED",
    message: "Alpaca rejected the PAPER order.",
  });
  assert.equal(
    safePaperExecutionFailure(new Error("TimeoutError")).code,
    "ORDER_TIMEOUT",
  );
});

test("mock Alpaca accepted and filled states remain distinct", () => {
  assert.equal(normalizePaperExecutionStatus("new"), "ACCEPTED");
  assert.equal(
    normalizePaperExecutionStatus("partially_filled"),
    "PARTIALLY_FILLED",
  );
  assert.equal(normalizePaperExecutionStatus("filled"), "FILLED");
  assert.equal(normalizePaperExecutionStatus("rejected"), "REJECTED");
});

test("portfolio, Active Trades, protection, and journal consume authoritative synchronization", async () => {
  const [worker, dashboard, workflow] = await Promise.all([
    read("hosted-worker/index.mjs"),
    read("app/api/dashboard/route.ts"),
    read("src/services/paper-workflow.ts"),
  ]);
  assert.match(worker, /synchronizeOwnerPortfolio/);
  assert.match(worker, /paper_positions/);
  assert.match(worker, /submitProtectivePaperExit/);
  assert.match(worker, /completed_paper_trades/);
  assert.match(dashboard, /paper_positions/);
  assert.match(workflow, /activeTradeSummary/);
});

test("LIVE remains impossible and broker secrets stay Railway-only", async () => {
  const [route, worker, client] = await Promise.all([
    read("app/api/broker/orders/route.ts"),
    read("hosted-worker/index.mjs"),
    read("components/trading-command-center.tsx"),
  ]);
  assert.match(route, /LIVE_TRADING_LOCKED/);
  assert.match(worker, /BROKER_ADAPTER !== "ALPACA_PAPER"/);
  assert.match(worker, /LIVE_TRADING_LOCKED/);
  assert.doesNotMatch(route, /ALPACA_PAPER_API_KEY|ALPACA_PAPER_API_SECRET/);
  assert.doesNotMatch(client, /ALPACA_PAPER_API_KEY|ALPACA_PAPER_API_SECRET/);
});
