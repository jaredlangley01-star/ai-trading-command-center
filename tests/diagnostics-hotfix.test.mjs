import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  heartbeatIsFresh,
  readTradingWorkerHealth,
  safeDiagnosticError,
} from "../src/services/diagnostics.ts";
import { getEnvironmentReadiness } from "../src/config/environments.ts";

const currentHeartbeat = (metadata = {}) => ({
  last_seen_at: new Date().toISOString(),
  status: "ONLINE",
  runtime: "HOSTED_PRODUCTION",
  metadata,
});

test("successful diagnostics run accepts a fresh authenticated API payload", () => {
  const client = fs.readFileSync(
    new URL("../components/trade-016-workspaces.tsx", import.meta.url),
    "utf8",
  );
  assert.match(client, /fetch\("\/api\/diagnostics"/);
  assert.match(client, /credentials: "same-origin"/);
  assert.match(client, /if \(payload\?\.checks\) setData\(payload\)/);
  assert.match(client, /data\?\.generatedAt/);
  assert.match(client, /RUNNING…/);
});

test("failed diagnostics request displays safe HTTP detail and timestamp", () => {
  const client = fs.readFileSync(
    new URL("../components/trade-016-workspaces.tsx", import.meta.url),
    "utf8",
  );
  const route = fs.readFileSync(
    new URL("../app/api/diagnostics/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(client, /HTTP \$\{response\.status\}/);
  assert.match(client, /SYSTEM CHECK FAILED/);
  assert.match(client, /FAILED AT/);
  assert.match(route, /failurePayload/);
  assert.equal(
    safeDiagnosticError("Risk Manager", "42501"),
    "Risk Manager query failed (42501). No secrets were exposed.",
  );
});

test("repeated diagnostics clicks are synchronously protected", () => {
  const client = fs.readFileSync(
    new URL("../components/trade-016-workspaces.tsx", import.meta.url),
    "utf8",
  );
  assert.match(client, /requestInFlight = useRef\(false\)/);
  assert.match(client, /if \(requestInFlight\.current\) return/);
  assert.match(client, /requestInFlight\.current = true/);
  assert.match(client, /disabled=\{running\}/);
});

test("worker heartbeat detection requires ONLINE and fresh owner state", () => {
  const now = Date.now();
  assert.equal(
    heartbeatIsFresh({
      last_seen_at: new Date(now - 30_000).toISOString(),
      status: "ONLINE",
    }),
    true,
  );
  assert.equal(
    heartbeatIsFresh({
      last_seen_at: new Date(now - 180_000).toISOString(),
      status: "ONLINE",
    }),
    false,
  );
  assert.equal(
    heartbeatIsFresh({
      last_seen_at: new Date(now).toISOString(),
      status: "ERROR",
    }),
    false,
  );
});

test("PAPER broker readiness is derived from Railway health without Vercel secrets", () => {
  const health = readTradingWorkerHealth(
    currentHeartbeat({
      accountStatus: "ACTIVE",
      broker: "ALPACA_PAPER",
      marketData: "ALPACA_IEX",
      safety: "LIVE_LOCKED",
    }),
  );
  assert.equal(health.online, true);
  assert.equal(health.hostedRuntime, true);
  assert.equal(health.paperBrokerConfigured, true);
  assert.equal(health.paperBrokerHealthy, true);
  assert.equal(health.marketDataHealthy, true);
  assert.equal(health.liveLocked, true);
});

test("missing LIVE credentials remain not configured and locked", () => {
  const previous = {
    key: process.env.ALPACA_LIVE_API_KEY,
    secret: process.env.ALPACA_LIVE_API_SECRET,
    enabled: process.env.LIVE_TRADING_ENABLED,
  };
  delete process.env.ALPACA_LIVE_API_KEY;
  delete process.env.ALPACA_LIVE_API_SECRET;
  process.env.LIVE_TRADING_ENABLED = "false";
  try {
    const live = getEnvironmentReadiness("LIVE");
    assert.equal(live.credentialsConfigured, false);
    assert.equal(live.executionEnabled, false);
    assert.equal(live.label, "NOT CONFIGURED");
  } finally {
    if (previous.key === undefined) delete process.env.ALPACA_LIVE_API_KEY;
    else process.env.ALPACA_LIVE_API_KEY = previous.key;
    if (previous.secret === undefined)
      delete process.env.ALPACA_LIVE_API_SECRET;
    else process.env.ALPACA_LIVE_API_SECRET = previous.secret;
    if (previous.enabled === undefined) delete process.env.LIVE_TRADING_ENABLED;
    else process.env.LIVE_TRADING_ENABLED = previous.enabled;
  }
});

test("TRADE-016.1 migration detection remains the final committed version", () => {
  const route = fs.readFileSync(
    new URL("../app/api/diagnostics/route.ts", import.meta.url),
    "utf8",
  );
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608140010_trade_016_final_production.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /202608140010_trade_016_final_production/);
  assert.ok(
    migration.lastIndexOf("insert into schema_migrations (version)") >
      migration.lastIndexOf("create policy"),
  );
});
