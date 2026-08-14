import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
test("protected dashboard requires Supabase auth and provides login/logout", async () => {
  const [page, login, logout] = await Promise.all([
    read("../app/page.tsx"),
    read("../components/login-form.tsx"),
    read("../components/logout-button.tsx"),
  ]);
  assert.match(page, /getAuthenticatedOwner/);
  assert.match(page, /redirect\("\/login"\)/);
  assert.match(login, /signInWithPassword/);
  assert.match(logout, /signOut/);
  assert.doesNotMatch(login, /signUp/);
});
test("service role is never exposed to client code", async () => {
  const files = await Promise.all([
    read("../components/login-form.tsx"),
    read("../components/trading-command-center.tsx"),
    read("../src/lib/supabase/client.ts"),
  ]);
  assert.doesNotMatch(files.join("\n"), /SUPABASE_SERVICE_ROLE_KEY/);
});
test("RLS policies scope all persisted tables to auth.uid", async () => {
  const sql = await read(
    "../supabase/migrations/202608130002_trade_003_auth_rls.sql",
  );
  for (const table of [
    "profiles",
    "broker_accounts",
    "risk_settings",
    "strategies",
    "recommendations",
    "orders",
    "positions",
    "trades",
    "journal_entries",
    "backtests",
    "notifications",
    "system_state",
    "audit_events",
  ]) {
    assert.match(sql, new RegExp(table));
  }
  assert.ok((sql.match(/auth\.uid\(\)/g) ?? []).length >= 13);
  assert.match(sql, /mode = 'PAPER'/);
});
test("state endpoint authenticates and never executes trades", async () => {
  const route = await read("../app/api/state/route.ts");
  assert.match(route, /Unauthorized/);
  assert.match(route, /emergency_stop_active/);
  assert.match(route, /execution:\s*false/);
  assert.doesNotMatch(route, /submitOrder|executeOrder|broker/i);
});
