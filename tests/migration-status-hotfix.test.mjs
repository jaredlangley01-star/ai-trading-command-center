import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Diagnostics requires TRADE-016 and TRADE-016.4 migration records", async () => {
  const route = await read("app/api/diagnostics/route.ts");
  const diagnostics = await read("src/services/diagnostics.ts");
  assert.match(diagnostics, /202608140010_trade_016_final_production/);
  assert.match(diagnostics, /202608160001_trade_016_4_owner_workflow/);
  assert.match(route, /\.select\("version"\)/);
  assert.match(route, /missingMigrations/);
  assert.match(route, /Required schema migrations recorded through/);
});

test("repair records TRADE-016 only after structural and RLS verification", async () => {
  const sql = await read(
    "supabase/migrations/202608160002_trade_016_migration_status_repair.sql",
  );
  const marker = "values ('202608140010_trade_016_final_production')";
  assert.match(sql, /^begin;/);
  assert.match(sql, /to_regclass\('public\.trading_environment_settings'\)/);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /not c\.relrowsecurity/);
  assert.match(sql, /Owners manage environment settings/);
  assert.match(sql, /Owners read notification heartbeat/);
  assert.match(sql, /auth\.uid\(\)=user_id/);
  assert.match(sql, /raise exception 'TRADE-016 repair blocked/);
  assert.match(sql, /on conflict \(user_id, environment\) do nothing/);
  assert.ok(sql.indexOf(marker) > sql.lastIndexOf("create policy"));
  assert.ok(
    sql.indexOf(marker) > sql.lastIndexOf("required schema is incomplete"),
  );
  assert.match(sql, /202608160002_trade_016_migration_status_repair/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
});
