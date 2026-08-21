import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findMissingDiagnosticMigrations,
  migrationQueryFailureDetail,
} from "../src/services/diagnostics.ts";
import { getSupabaseProjectIdentity } from "../src/lib/supabase/config.ts";

const trade016 = "202608140010_trade_016_final_production";
const trade0164 = "202608160001_trade_016_4_owner_workflow";
const repair = "202608160002_trade_016_migration_status_repair";
const trade0165 = "202608160003_trade_016_5_paper_execution_queue";
const trade0166 = "202608170001_trade_016_6_session_freshness";
const trade0167 = "202608170002_trade_016_7_order_monitor";
const trade017 = "202608200001_trade_017_intraday_trader";
const trade018 = "202608200002_trade_018_paper_automation_stress";
const trade0181 = "202608200003_trade_018_1_paper_test_persistence_hotfix";
const trade0183 = "202608210001_trade_018_3_execution_recovery";

test("A: required migration rows returned means no missing migrations", () => {
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
      { version: trade0183 },
    ]),
    [],
  );
});

test("B and D: missing or empty successful results remain degraded", () => {
  assert.deepEqual(findMissingDiagnosticMigrations([{ version: trade016 }]), [
    trade0164,
    trade0165,
    trade0166,
    trade0167,
    trade017,
    trade018,
    trade0181,
    trade0183,
  ]);
  assert.deepEqual(findMissingDiagnosticMigrations([]), [
    trade016,
    trade0164,
    trade0165,
    trade0166,
    trade0167,
    trade017,
    trade018,
    trade0181,
    trade0183,
  ]);
});

test("C: permission and RLS errors are check failures, not missing rows", () => {
  assert.equal(
    migrationQueryFailureDetail({
      code: "42501",
      message: "permission denied",
    }),
    "Migration check failed: permission denied.",
  );
  assert.equal(
    migrationQueryFailureDetail({
      message: "violates row-level security policy",
    }),
    "Migration check failed: permission denied.",
  );
});

test("E: unavailable Supabase configuration is a failed connection", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assert.deepEqual(getSupabaseProjectIdentity(), {
      hostname: null,
      projectRef: null,
    });
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  }

  const route = await readFile(
    new URL("../app/api/diagnostics/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /Supabase server configuration is unavailable/);
  assert.match(route, /503/);
});

test("F: exact versions are compared without normalization", () => {
  assert.deepEqual(
    findMissingDiagnosticMigrations([
      { version: `${trade016} ` },
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
      trade0183,
    ],
  );
});

test("owner-only response traces client, project, rows, expectations, and errors safely", async () => {
  const [route, server, client] = await Promise.all([
    readFile(
      new URL("../app/api/diagnostics/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../components/trade-016-workspaces.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(route, /diagnosticTrace: \{ migrations: migrationTrace \}/);
  assert.match(route, /querySucceeded/);
  assert.match(route, /returnedVersions/);
  assert.match(route, /expectedVersions/);
  assert.match(route, /supabaseHostname/);
  assert.match(route, /supabaseProjectRef/);
  assert.match(route, /SERVER_SERVICE_ROLE/);
  assert.match(route, /AUTHENTICATED_ANON/);
  assert.match(server, /persistSession: false/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
});
