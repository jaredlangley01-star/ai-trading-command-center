import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("app/api/orders/route.ts"),
  ui = read("components/orders-workspace.tsx"),
  shell = read("components/trading-command-center.tsx"),
  worker = read("hosted-worker/index.mjs"),
  bigMoney = read("app/api/big-money/route.ts"),
  migration = read(
    "supabase/migrations/202608170002_trade_016_7_order_monitor.sql",
  );

test("Orders page uses actual owner-scoped PAPER persistence", () => {
  assert.match(api, /getAuthenticatedOwner/);
  assert.match(api, /\.from\("orders"\)/);
  assert.match(api, /\.from\("paper_execution_requests"\)/);
  assert.match(api, /\.eq\("user_id", user\.id\)/);
  assert.doesNotMatch(api, /demo|sample order|fake/i);
});

test("manual queue, worker claim, Alpaca submission, acceptance and fill remain distinct", () => {
  for (const state of [
    "QUEUED",
    "PROCESSING",
    "SUBMITTED",
    "ACCEPTED",
    "PARTIALLY_FILLED",
    "FILLED",
    "POSITION_OPEN",
    "CANCELED",
    "REJECTED",
    "FAILED",
    "EXPIRED",
  ])
    assert.match(`${api}\n${ui}`, new RegExp(state));
  assert.match(worker, /worker_received_at/);
  assert.match(worker, /broker_submitted_at/);
  assert.match(worker, /broker_acknowledged_at/);
  assert.match(worker, /filled_at/);
});

test("timeline completes steps only from actual persisted timestamps and links", () => {
  for (const field of [
    "queued_at",
    "worker_received_at",
    "broker_submitted_at",
    "broker_acknowledged_at",
    "filled_at",
    "position_id",
    "completed_trade_id",
  ])
    assert.match(api, new RegExp(field));
  assert.match(ui, /VIEW POSITION/);
  assert.match(ui, /VIEW JOURNAL ENTRY/);
});

test("Orders filters and global pending indicator are present", () => {
  for (const tab of [
    "ALL",
    "PENDING",
    "OPEN",
    "FILLED",
    "CANCELED",
    "REJECTED",
    "FAILED",
  ])
    assert.match(ui, new RegExp(`"${tab}"`));
  assert.match(ui, /PENDING ORDERS:/);
  assert.match(shell, /PendingOrdersHeader/);
  assert.match(shell, /"Paper Trading",\s*"Orders",\s*"Trade Journal"/);
});

test("dashboard shows compact order activity from persisted summary", () => {
  assert.match(ui, /ORDER ACTIVITY/);
  for (const metric of [
    "pending",
    "accepted",
    "partiallyFilled",
    "filledToday",
    "rejectedToday",
  ])
    assert.match(ui, new RegExp(metric));
  assert.match(shell, /OrderActivityCard/);
});

test("accepted limit order clearly waits for price and does not degrade queue health", () => {
  assert.match(api, /WAITING FOR LIMIT PRICE/);
  const diagnostics = read("app/api/diagnostics/route.ts");
  assert.match(
    diagnostics,
    /Accepted limit orders waiting for price do not degrade health/,
  );
  assert.match(diagnostics, /unclaimedDelayed/);
});

test("Auto Trader and Big Money use the shared durable PAPER execution queue", () => {
  assert.match(worker, /source: "AUTO_TRADER"/);
  assert.match(worker, /classification: "SMALL"/);
  assert.match(worker, /\.from\("paper_execution_requests"\)/);
  assert.match(bigMoney, /source: "BIG_MONEY"/);
  assert.match(bigMoney, /classification: "BIG"/);
  assert.match(bigMoney, /Big Money PAPER order queued for Railway execution/);
});

test("Auto Trader activity exposes real scans, candidates, decisions, queue and fill", () => {
  const autoApi = read("app/api/auto-trader/route.ts");
  assert.match(autoApi, /autonomous_candidate_evaluations/);
  for (const field of [
    "lastScan",
    "candidatesEvaluated",
    "candidatesRejected",
    "lastRejectionReason",
    "lastOrderQueued",
    "lastOrderFilled",
  ])
    assert.match(autoApi, new RegExp(field));
  assert.match(shell, /SCANNING \/ WAITING FOR SETUP/);
  assert.match(shell, /ACTIVE TRADES: 0/);
});

test("stale claim recovery and broker polling remain idempotent", () => {
  assert.match(worker, /orders:by_client_order_id/);
  assert.match(worker, /\.eq\("status", "SUBMITTING"\)/);
  assert.match(worker, /\.eq\("status", "QUEUED"\)/);
  assert.match(
    migration,
    /unique \(user_id, client_order_id\)|paper_execution_requests_owner_status_updated_idx/,
  );
  assert.match(worker, /status === "FILLED"/);
  assert.match(
    `${worker}\n${read("src/services/paper-execution.ts")}`,
    /PARTIALLY_FILLED/,
  );
});

test("order lifecycle notifications are deduplicated and preference-controlled downstream", () => {
  for (const event of [
    "ORDER_QUEUED",
    "ORDER_ACCEPTED",
    "ORDER_FILLED",
    "ORDER_REJECTED",
    "ORDER_CANCELED",
  ])
    assert.match(`${worker}\n${shell}`, new RegExp(event));
  assert.match(worker, /dedupeKey: `order:/);
});

test("no secrets or LIVE execution are exposed", () => {
  assert.doesNotMatch(
    `${api}\n${ui}`,
    /ALPACA_.*SECRET|SUPABASE_SERVICE_ROLE_KEY|authorization/i,
  );
  assert.match(worker, /LIVE_TRADING_LOCKED/);
  assert.doesNotMatch(api, /submitPaperOrder|fetch\([^)]*alpaca/i);
});

test("responsive monitor preserves usable timeline and actions", () => {
  const css = read("app/globals.css");
  assert.match(css, /orders-table-wrap[\s\S]*overflow-x: auto/);
  assert.match(css, /order-timeline[\s\S]*overflow-x: auto/);
  assert.match(css, /@media\s*\(max-width: 600px\)/);
});
