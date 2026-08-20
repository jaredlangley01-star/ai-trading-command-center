import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("UI submits the complete owner configuration and hydrates it from GET", () => {
  const ui = read("components/trading-command-center.tsx");
  assert.match(ui, /body: JSON\.stringify\(\{[\s\S]*config,[\s\S]*symbol/);
  assert.match(ui, /setConfig\(data\.config\)/);
  assert.match(ui, /checked=\{config\.paperTestMode\}/);
});

test("save verifies the Supabase write instead of reporting false success", () => {
  const api = read("app/api/auto-trader/route.ts");
  assert.match(api, /\.upsert\([\s\S]*paper_test_mode: config\.paperTestMode/);
  assert.match(api, /\.select\("\*"\)[\s\S]*\.single\(\)/);
  assert.match(api, /CONFIG_WRITE_VERIFICATION_FAILED/);
  assert.match(api, /AUTO_TRADER_CONFIG_PERSISTENCE_FAILED/);
  assert.match(api, /persisted: true/);
});

test("reload hydrates persisted true and defaults OFF only without a row", () => {
  const api = read("app/api/auto-trader/route.ts");
  assert.match(api, /row\.paper_test_mode === true/);
  assert.match(api, /: defaultAutoTraderConfig/);
  assert.match(
    api,
    /if \(config\.error\)[\s\S]*AUTO_TRADER_CONFIG_LOAD_FAILED/,
  );
});

test("all TRADE-018 settings use matching persisted columns", () => {
  const api = read("app/api/auto-trader/route.ts");
  for (const column of [
    "paper_test_mode",
    "paper_test_target_auto_positions",
    "paper_big_money_test_mode",
    "paper_test_target_big_money_positions",
    "paper_big_money_auto_approve_test",
    "paper_test_min_opportunity_score",
    "paper_test_min_confidence",
    "paper_test_max_position_size",
    "paper_test_max_risk_per_trade",
    "paper_test_max_daily_trades",
    "paper_test_universe",
  ])
    assert.match(api, new RegExp(column));
});

test("Railway reads the same persisted owner row and exact test-mode field", () => {
  const worker = read("hosted-worker/index.mjs");
  assert.match(
    worker,
    /from\("auto_trader_config"\)[\s\S]*select\("\*"\)[\s\S]*eq\("user_id", ownerId\)/,
  );
  assert.match(worker, /paperTestMode: row\.paper_test_mode === true/);
  assert.match(
    worker,
    /paperTestTargetAutoPositions: number\([\s\S]*row\.paper_test_target_auto_positions \?\? 8[\s\S]*\)/,
  );
});

test("hotfix migration is idempotent, owner scoped, and default OFF", () => {
  const migration = read(
    "supabase/migrations/202608200003_trade_018_1_paper_test_persistence_hotfix.sql",
  );
  assert.match(
    migration,
    /add column if not exists paper_test_mode boolean not null default false/,
  );
  assert.match(migration, /Owners manage Auto Trader configuration/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.match(
    migration,
    /202608200003_trade_018_1_paper_test_persistence_hotfix/,
  );
});

test("PAPER, LIVE lock, risk gates, broker confirmation and 8-slot logic remain", () => {
  const worker = read("hosted-worker/index.mjs");
  assert.match(worker, /assertPaperTestEnvironment/);
  assert.match(worker, /ProductionRiskManager/);
  assert.match(worker, /TradePermissionService/);
  assert.match(worker, /broker_position_id/);
  assert.match(worker, /paperTestTargetAutoPositions/);
});
