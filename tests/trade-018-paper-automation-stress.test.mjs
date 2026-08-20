import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertPaperTestEnvironment,
  availableTestSlots,
  canAutoApproveBigMoneyTest,
  confirmedBrokerPositions,
  defaultPaperTestSettings,
  paperTestStatus,
  rankForTestCoverage,
} from "../src/services/paper-automation-test.ts";

const read = (path) => fs.readFileSync(path, "utf8");

test("0/8 fills eight slots, 3/8 fills five, and 8/8 blocks", () => {
  assert.equal(availableTestSlots(8, 0), 8);
  assert.equal(availableTestSlots(8, 3), 5);
  assert.equal(availableTestSlots(8, 8), 0);
});

test("a closed position frees a replacement slot", () => {
  assert.equal(availableTestSlots(8, 8), 0);
  assert.equal(availableTestSlots(8, 7), 1);
  assert.match(
    read("hosted-worker/index.mjs"),
    /for \(let attempt = 0; attempt < Math\.max\(1, attempts\)/,
  );
});

test("only broker-confirmed positions count and fake local positions do not", () => {
  const positions = confirmedBrokerPositions([
    { status: "OPEN", broker_position_id: "alpaca-1" },
    { status: "OPEN" },
    { status: "CLOSED", broker_order_id: "alpaca-2" },
  ]);
  assert.equal(positions.length, 1);
});

test("duplicate symbols are removed and under-tested strategy is preferred", () => {
  const ranked = rankForTestCoverage(
    [
      { symbol: "AAPL", strategy: "Momentum", rankScore: 99 },
      { symbol: "MSFT", strategy: "Momentum", rankScore: 95 },
      { symbol: "NVDA", strategy: "Mean Reversion", rankScore: 80 },
    ],
    { Momentum: 4, "Mean Reversion": 0 },
    ["AAPL"],
  );
  assert.deepEqual(
    ranked.map((item) => item.symbol),
    ["NVDA", "MSFT"],
  );
});

test("Big Money target and auto-approval OFF are enforced", () => {
  const result = canAutoApproveBigMoneyTest({
    settings: defaultPaperTestSettings,
    mode: "PAPER",
    liveTradingEnabled: false,
    confirmedPositions: 0,
    recommendationStatus: "PENDING",
    researchScore: 99,
    requiredScore: 85,
    researchAvailable: true,
  });
  assert.equal(result.reason, "TEST_AUTO_APPROVAL_OFF");
});

test("Big Money test auto-approval ON still requires deterministic qualification", () => {
  const settings = {
    ...defaultPaperTestSettings,
    bigMoneyEnabled: true,
    bigMoneyAutoApprove: true,
  };
  assert.equal(
    canAutoApproveBigMoneyTest({
      settings,
      mode: "PAPER",
      liveTradingEnabled: false,
      confirmedPositions: 0,
      recommendationStatus: "PENDING",
      researchScore: 90,
      requiredScore: 85,
      researchAvailable: true,
    }).allowed,
    true,
  );
  assert.equal(
    canAutoApproveBigMoneyTest({
      settings,
      mode: "PAPER",
      liveTradingEnabled: false,
      confirmedPositions: 2,
      recommendationStatus: "PENDING",
      researchScore: 90,
      requiredScore: 85,
      researchAvailable: true,
    }).allowed,
    false,
  );
  const worker = read("hosted-worker/index.mjs");
  assert.match(worker, /BIG_MONEY_TEST_AUTO_APPROVAL/);
  assert.match(worker, /new ProductionRiskManager\(settings\)\.evaluateOrder/);
  assert.match(worker, /new TradePermissionService\(state, settings\)/);
});

test("PAPER-only enforcement rejects LIVE and non-paper brokers", () => {
  assert.doesNotThrow(() =>
    assertPaperTestEnvironment({
      mode: "PAPER",
      brokerAdapter: "ALPACA_PAPER",
      liveTradingEnabled: false,
    }),
  );
  assert.throws(
    () =>
      assertPaperTestEnvironment({
        mode: "LIVE",
        brokerAdapter: "ALPACA_PAPER",
        liveTradingEnabled: false,
      }),
    /PAPER_TEST_LIVE_LOCKED/,
  );
  assert.throws(
    () =>
      assertPaperTestEnvironment({
        mode: "PAPER",
        brokerAdapter: "ALPACA_LIVE",
        liveTradingEnabled: true,
      }),
    /PAPER_TEST_LIVE_LOCKED/,
  );
});

test("session closed waits and does not fabricate activity", () => {
  assert.equal(
    paperTestStatus({
      enabled: true,
      sessionOpen: false,
      autoConfirmed: 0,
      autoTarget: 8,
    }),
    "WAITING_FOR_SESSION",
  );
  assert.match(
    read("hosted-worker/index.mjs"),
    /OUTSIDE_INTRADAY_ENTRY_WINDOW/,
  );
});

test("TRADE-017 end-of-day exits and restart claims remain intact", () => {
  const worker = read("hosted-worker/index.mjs");
  assert.match(worker, /END_OF_SESSION/);
  assert.match(worker, /autonomous_execution_claims/);
  assert.match(worker, /paper_position_exit_claims/);
});

test("stopping test mode blocks entries without disabling position management", () => {
  const api = read("app/api/trader/route.ts");
  assert.match(api, /paper_test_mode: enable/);
  assert.doesNotMatch(api, /paper_positions.*delete/);
});

test("unprotected positions block additional stress slots and raise warnings", () => {
  const worker = read("hosted-worker/index.mjs");
  assert.match(worker, /protection_status === "UNPROTECTED"/);
  assert.match(worker, /PROTECTIVE_EXIT_FAILURE/);
});

test("Trader test controls require owner authentication and confirmation", () => {
  const route = read("app/api/trader/route.ts");
  const ui = read("components/trader-assistant.tsx");
  assert.match(route, /getAuthenticatedOwner/);
  assert.match(route, /OWNER_CONFIRMATION_REQUIRED/);
  assert.match(ui, /window\.confirm/);
  assert.doesNotMatch(route, /submitPaperOrder/);
});

test("notifications are deduplicated and exports include stress audit data", () => {
  const worker = read("hosted-worker/index.mjs");
  const exportsRoute = read("app/api/exports/[kind]/route.ts");
  assert.match(worker, /paper-test-target:/);
  for (const field of [
    "paper_test_mode",
    "test_slot",
    "candidate_rank",
    "selection_reason",
    "test_thresholds",
  ])
    assert.match(exportsRoute, new RegExp(field));
});

test("migration is additive, owner scoped, RLS enabled, and defaults OFF", () => {
  const migration = read(
    "supabase/migrations/202608200002_trade_018_paper_automation_stress.sql",
  );
  assert.match(migration, /paper_test_mode boolean not null default false/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
});

test("Railway workers preserve explicit native ESM TypeScript imports", () => {
  for (const file of [
    "hosted-worker/index.mjs",
    "hosted-worker/notification-worker.mjs",
    "hosted-worker/trader-worker.mjs",
  ])
    assert.doesNotMatch(read(file), /from ["']\.\.\/src\/[^"']+(?<!\.ts)["']/);
});
