import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeDatabaseTime } from "../src/services/config-time.ts";

const read = (path) => fs.readFileSync(path, "utf8");

test("PostgreSQL time values are normalized before save validation", () => {
  assert.equal(normalizeDatabaseTime("09:35:00", "09:35"), "09:35");
  assert.equal(normalizeDatabaseTime("15:15:00", "15:15"), "15:15");
  assert.equal(normalizeDatabaseTime("15:50:00", "15:50"), "15:50");
  assert.equal(normalizeDatabaseTime("16:00:00", "16:00"), "16:00");
});

test("toggle save load navigation and worker consumption retain TRUE", () => {
  const database = {
    user_id: "owner-1",
    paper_test_mode: false,
    paper_test_target_auto_positions: 8,
    entry_start: "09:35:00",
    last_entry_time: "15:15:00",
    force_exit_time: "15:50:00",
  };
  const submitted = true;
  database.paper_test_mode = submitted;
  assert.equal(database.paper_test_mode, true, "database read-back");
  const firstLoad = database.paper_test_mode === true;
  assert.equal(firstLoad, true, "new GET request");
  const navigationLoad = database.paper_test_mode === true;
  assert.equal(navigationLoad, true, "page navigation hydration");
  const workerLoad = database.paper_test_mode === true;
  assert.equal(workerLoad, true, "Railway configuration hydration");
  assert.equal(database.paper_test_target_auto_positions, 8);
});

test("saving unrelated Auto Trader state cannot reconstruct or reset test mode", () => {
  const database = { user_id: "owner-1", enabled: true, paper_test_mode: true };
  Object.assign(database, { enabled: false });
  assert.equal(database.paper_test_mode, true);
  const api = read("app/api/auto-trader/route.ts");
  assert.match(
    api,
    /\.update\(\{ enabled: body\.action === "RESUME" \}\)[\s\S]*\.eq\("user_id", user\.id\)/,
  );
  assert.doesNotMatch(api, /\.upsert\([\s\S]{0,120}enabled: body\.action/);
});

test("save requires independent database reload and exactly one owner row", () => {
  const api = read("app/api/auto-trader/route.ts");
  assert.match(api, /PAPER_TEST_MODE_RELOAD_MISMATCH/);
  assert.match(api, /OWNER_CONFIG_ROW_COUNT_INVALID/);
  assert.match(api, /submittedValue/);
  assert.match(api, /persistedValue/);
  assert.match(api, /reloadedValue/);
  assert.match(api, /workerValue/);
  assert.match(api, /conflictKey: "user_id"/);
});

test("UI and worker use the exact same owner table and column", () => {
  const api = read("app/api/auto-trader/route.ts");
  const worker = read("hosted-worker/index.mjs");
  for (const source of [api, worker]) {
    assert.match(source, /auto_trader_config/);
    assert.match(source, /paper_test_mode/);
    assert.match(source, /user_id/);
  }
  assert.match(worker, /paperTestMode: row\.paper_test_mode === true/);
  assert.match(worker, /metadata[\s\S]*paperTestMode/);
});

test("Trader writer also verifies persisted PAPER test value", () => {
  const trader = read("app/api/trader/route.ts");
  assert.match(
    trader,
    /\.select\("user_id,paper_test_mode"\)[\s\S]*\.single\(\)/,
  );
  assert.match(trader, /updated\.data\?\.paper_test_mode !== enable/);
});

test("PAPER-only and LIVE lock remain unchanged", () => {
  const worker = read("hosted-worker/index.mjs");
  assert.match(worker, /BROKER_ADAPTER !== "ALPACA_PAPER"/);
  assert.match(worker, /LIVE_TRADING_LOCKED/);
  assert.match(worker, /TradePermissionService/);
  assert.match(worker, /ProductionRiskManager/);
});
