import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findMissingDiagnosticMigrations,
  REQUIRED_DIAGNOSTIC_MIGRATIONS,
} from "../src/services/diagnostics.ts";

const trade016 = "202608140010_trade_016_final_production";
const trade0164 = "202608160001_trade_016_4_owner_workflow";
const repair = "202608160002_trade_016_migration_status_repair";
const trade0165 = "202608160003_trade_016_5_paper_execution_queue";
const trade0166 = "202608170001_trade_016_6_session_freshness";
const trade0167 = "202608170002_trade_016_7_order_monitor";
const trade017 = "202608200001_trade_017_intraday_trader";
const trade018 = "202608200002_trade_018_paper_automation_stress";
const trade0181 = "202608200003_trade_018_1_paper_test_persistence_hotfix";

test("exact production migration rows are recognized with the repair marker present", () => {
  assert.deepEqual(REQUIRED_DIAGNOSTIC_MIGRATIONS, [
    trade016,
    trade0164,
    trade0165,
    trade0166,
    trade0167,
    trade017,
    trade018,
    trade0181,
  ]);
  assert.deepEqual(
    findMissingDiagnosticMigrations([
      { version: trade016 },
      { version: trade0164 },
      { version: repair },
      { version: trade0165 },
      { version: trade0166 },
      { version: trade0167 },
      { version: trade017 },
      { version: trade018 },
      { version: trade0181 },
    ]),
    [],
  );
});

test("a genuinely missing required migration remains degraded", () => {
  assert.deepEqual(
    findMissingDiagnosticMigrations([
      { version: trade016 },
      { version: repair },
    ]),
    [trade0164, trade0165, trade0166, trade0167, trade017, trade018, trade0181],
  );
});

test("migration comparison is exact and does not normalize returned versions", () => {
  assert.deepEqual(
    findMissingDiagnosticMigrations([
      { version: ` ${trade016}` },
      { version: trade0164.toUpperCase() },
    ]),
    [
      trade016,
      trade0164,
      trade0165,
      trade0166,
      trade0167,
      trade017,
      trade018,
      trade0181,
    ],
  );
});

test("every diagnostics run reads the unfiltered ledger without caching", async () => {
  const route = await readFile(
    new URL("../app/api/diagnostics/route.ts", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("../components/trade-016-workspaces.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export const revalidate = 0/);
  assert.match(
    route,
    /\.from\("schema_migrations"\)[\s\S]*?\.select\("version"\)[\s\S]*?\.order\("version"/,
  );
  assert.doesNotMatch(route, /\.in\("version"/);
  assert.match(route, /private, no-store, no-cache, max-age=0/);
  assert.match(client, /\/api\/diagnostics\?run=/);
  assert.match(client, /cache: "no-store"/);
});
