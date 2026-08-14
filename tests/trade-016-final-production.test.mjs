import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getEnvironmentReadiness,
  validateEnvironmentSwitch,
  redactDiagnosticValue,
} from "../src/config/environments.ts";
import { assertHostedBrokerEligible } from "../src/config/runtime.ts";

const env = process.env;
function withEnvironment(values, callback) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = env[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test("PAPER and LIVE use isolated credentials and endpoints", () =>
  withEnvironment(
    {
      ALPACA_PAPER_API_KEY: "paper-key",
      ALPACA_PAPER_API_SECRET: "paper-secret",
      ALPACA_PAPER_BASE_URL: "https://paper-api.alpaca.markets",
      ALPACA_LIVE_API_KEY: undefined,
      ALPACA_LIVE_API_SECRET: undefined,
      ALPACA_LIVE_BASE_URL: "https://api.alpaca.markets",
      LIVE_TRADING_ENABLED: "false",
    },
    () => {
      assert.equal(getEnvironmentReadiness("PAPER").executionEnabled, true);
      assert.equal(
        getEnvironmentReadiness("LIVE").credentialsConfigured,
        false,
      );
      assert.equal(getEnvironmentReadiness("LIVE").executionEnabled, false);
    },
  ));

test("LIVE remains hard locked even when credentials exist", () =>
  withEnvironment(
    {
      ALPACA_LIVE_API_KEY: "live-key",
      ALPACA_LIVE_API_SECRET: "live-secret",
      ALPACA_LIVE_BASE_URL: "https://api.alpaca.markets",
      LIVE_TRADING_ENABLED: "false",
    },
    () => {
      const live = getEnvironmentReadiness("LIVE");
      assert.equal(live.label, "LIVE READY — LOCKED");
      assert.equal(
        validateEnvironmentSwitch({
          requested: "LIVE",
          confirmation: "ENABLE LIVE TRADING",
          criticalDiagnostics: 0,
          hasUnsafeOrderTransition: false,
          servicesHealthy: true,
        }).reason,
        "LIVE_TRADING_LOCKED",
      );
    },
  ));

test("LIVE confirmation, diagnostics, and transition gates are mandatory", () =>
  withEnvironment(
    {
      ALPACA_LIVE_API_KEY: "live-key",
      ALPACA_LIVE_API_SECRET: "live-secret",
      ALPACA_LIVE_BASE_URL: "https://api.alpaca.markets",
      LIVE_TRADING_ENABLED: "true",
    },
    () => {
      assert.equal(
        validateEnvironmentSwitch({
          requested: "LIVE",
          confirmation: "wrong",
          criticalDiagnostics: 0,
          hasUnsafeOrderTransition: false,
          servicesHealthy: true,
        }).reason,
        "LIVE_CONFIRMATION_REQUIRED",
      );
      assert.equal(
        validateEnvironmentSwitch({
          requested: "LIVE",
          confirmation: "ENABLE LIVE TRADING",
          criticalDiagnostics: 1,
          hasUnsafeOrderTransition: false,
          servicesHealthy: true,
        }).reason,
        "SYSTEM_NOT_READY",
      );
      assert.equal(
        validateEnvironmentSwitch({
          requested: "LIVE",
          confirmation: "ENABLE LIVE TRADING",
          criticalDiagnostics: 0,
          hasUnsafeOrderTransition: true,
          servicesHealthy: true,
        }).reason,
        "UNSAFE_ORDER_TRANSITION",
      );
    },
  ));

test("hosted production rejects local and IBKR broker infrastructure", () => {
  for (const candidate of [
    "http://localhost:8765",
    "http://127.0.0.1:4002",
    "IBKR_TWS_LOCAL",
    "TWS Gateway",
  ])
    assert.throws(() =>
      assertHostedBrokerEligible(
        "HOSTED_PRODUCTION",
        candidate.includes("IBKR") ? candidate : "ALPACA_PAPER",
        candidate,
      ),
    );
});

test("diagnostics redact secrets and remain non-authoritative", () => {
  assert.equal(redactDiagnosticValue("api_secret=abc"), "[REDACTED]");
  const source = fs.readFileSync(
    new URL("../app/api/diagnostics/route.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "submitPaperOrder",
    "cancelPaperOrder",
    "AUTO_TRADER_RESUMED",
    "LIVE_TRADING_ENABLED=true",
  ])
    assert.equal(source.includes(forbidden), false);
  assert.match(source, /nonTrading: true/);
});

test("charts and migrations are owner scoped and environment attributed", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608140010_trade_016_final_production.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /chart_drawings/);
  assert.match(migration, /auth\.uid\(\)\s*=\s*user_id/);
  assert.match(migration, /active_environment/);
  assert.match(migration, /maximumTradeSize/);
  assert.match(migration, /auto_trader_enabled boolean not null default false/);
  assert.match(migration, /^begin;/);
  assert.match(migration, /drop policy if exists/);
  assert.match(migration, /using \(auth\.uid\(\) = user_id\)/);
  assert.match(migration, /with check \(auth\.uid\(\) = user_id\)/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /commit;\s*$/);
  assert.ok(
    migration.lastIndexOf("insert into schema_migrations (version)") >
      migration.lastIndexOf(
        'create policy "Owners read notification heartbeat"',
      ),
  );
});

test("Lightweight Charts observes a bounded responsive container", () => {
  const component = fs.readFileSync(
    new URL("../components/professional-market-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const styles = fs.readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(component, /autoSize: true/);
  assert.doesNotMatch(component, /autoSize: true,\s*height:/);
  assert.match(styles, /\.lightweight-chart\s*{[^}]*height: 420px;/s);
  assert.doesNotMatch(
    styles,
    /\.lightweight-chart\s*{[^}]*min-height: 420px;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.lightweight-chart\s*{\s*height: 340px;/,
  );
});

test("TRADE-015.1 Railway ESM commands and explicit imports remain intact", () => {
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    pkg.scripts["worker:start"],
    "node --experimental-strip-types hosted-worker/index.mjs",
  );
  assert.equal(
    pkg.scripts["worker:notifications"],
    "node --experimental-strip-types hosted-worker/notification-worker.mjs",
  );
  const factory = fs.readFileSync(
    new URL("../src/services/market-data/factory.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(factory, /from ["'][.]{1,2}\/[^"']+(?<!\.ts)["']/);
});
