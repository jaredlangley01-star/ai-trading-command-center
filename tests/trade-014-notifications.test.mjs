import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  defaultNotificationPreferences,
  deepLink,
  isQuietHour,
  redactNotificationPayload,
  requiresCriticalConfirmation,
  shouldDeliver,
} from "../src/services/notifications/policy.ts";

const enabled = () => ({
  ...defaultNotificationPreferences,
  pushEnabled: true,
  types: { ...defaultNotificationPreferences.types },
});
test("preference toggles and critical disabling require acknowledgement", () => {
  const previous = enabled();
  const next = {
    ...previous,
    types: { ...previous.types, EMERGENCY_STOP: false },
  };
  assert.equal(requiresCriticalConfirmation(previous, next), true);
  assert.equal(
    shouldDeliver({ type: "EMERGENCY_STOP", severity: "CRITICAL" }, next)
      .deliver,
    false,
  );
});
test("quiet hours suppress ordinary alerts but preserve critical safety alerts", () => {
  const preferences = {
    ...enabled(),
    quietHoursEnabled: true,
    quietHoursStart: "00:00",
    quietHoursEnd: "23:59",
    timezone: "UTC",
  };
  assert.equal(
    isQuietHour(preferences, new Date("2026-01-01T12:00:00Z")),
    true,
  );
  assert.equal(
    shouldDeliver(
      {
        type: "BACKTEST_COMPLETED",
        severity: "INFO",
        createdAt: new Date("2026-01-01T12:00:00Z"),
      },
      preferences,
    ).reason,
    "QUIET_HOURS",
  );
  assert.equal(
    shouldDeliver(
      {
        type: "EMERGENCY_STOP",
        severity: "CRITICAL",
        createdAt: new Date("2026-01-01T12:00:00Z"),
      },
      preferences,
    ).deliver,
    true,
  );
});
test("opportunity threshold filters low scoring Big Money and research alerts", () => {
  const preferences = { ...enabled(), minimumOpportunityScore: 80 };
  assert.equal(
    shouldDeliver(
      {
        type: "BIG_MONEY_RECOMMENDATION",
        severity: "INFO",
        opportunityScore: 79,
      },
      preferences,
    ).reason,
    "BELOW_SCORE_THRESHOLD",
  );
  assert.equal(
    shouldDeliver(
      {
        type: "RESEARCH_OPPORTUNITY_FOUND",
        severity: "INFO",
        opportunityScore: 80,
      },
      preferences,
    ).deliver,
    true,
  );
});
test("notification payloads redact secrets and deep links require owner review", () => {
  assert.deepEqual(
    redactNotificationPayload({
      symbol: "AAPL",
      apiKey: "secret",
      access_token: "secret",
      confidence: 90,
    }),
    { symbol: "AAPL", confidence: 90 },
  );
  const link = deepLink("APPROVAL_REQUIRED", "rec-1");
  assert.match(link, /Big%20Money/);
  assert.doesNotMatch(link, /approve|execute|order/i);
});
test("service worker supports background display and authenticated deep-link opening", async () => {
  const sw = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /clients\.openWindow/);
  assert.doesNotMatch(sw, /broker|order|approve|risk.settings|LIVE/i);
});
test("subscription API creates and removes owner devices without private VAPID material", async () => {
  const route = await readFile(
    new URL("../app/api/push/subscriptions/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /auth\.getUser/);
  assert.doesNotMatch(
    route,
    /VAPID_PRIVATE_KEY|BrokerService|submitPaperOrder/,
  );
});
test("notification worker implements cooldown, dedupe, restart recovery and provider fallback", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/notification-worker.mjs", import.meta.url),
    "utf8",
  );
  for (const pattern of [
    /notification_cooldowns/,
    /dedupe_key/,
    /WORKER_RESTART_RECOVERY/,
    /PROVIDER_FAILURE/,
    /NO_ACTIVE_SUBSCRIPTION/,
    /404 \|\| status === 410/,
  ])
    assert.match(worker, pattern);
  assert.doesNotMatch(
    worker,
    /localhost|127\.0\.0\.1|IBKR|TWS|BrokerService|submitPaperOrder|cancelOrder/i,
  );
});
test("push failure cannot stop trading or protective exits", async () => {
  const trading = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(trading, /processBacktestJob/);
  assert.match(trading, /synchronizeOwnerPortfolio/);
  assert.match(trading, /ProtectiveExitService/);
  assert.doesNotMatch(trading, /webpush\.sendNotification/);
});
test("notification center supports unread state, filters and safe test", async () => {
  const ui = await readFile(
    new URL("../components/notification-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /unreadCount/);
  assert.match(ui, /All categories/);
  assert.match(ui, /All severities/);
  assert.match(ui, /Mark all as read/);
  assert.match(ui, /Safe test queued/);
});
test("migration is owner scoped and stores no VAPID private key", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/202608140008_trade_014_push_notifications.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const table of [
    "push_subscriptions",
    "notification_preferences",
    "notification_events",
    "notification_delivery_attempts",
    "notification_read_state",
    "notification_cooldowns",
  ])
    assert.match(
      sql,
      new RegExp(`alter table ${table} enable row level security`, "i"),
    );
  assert.doesNotMatch(sql, /vapid_private|private_key|password/i);
});
test("hosted PWA and notification services retain LIVE lock and no local dependency", async () => {
  const files = await Promise.all(
    [
      "../hosted-worker/notification-worker.mjs",
      "../public/sw.js",
      "../src/services/notifications/policy.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.doesNotMatch(files.join("\n"), /localhost|127\.0\.0\.1|IBKR|TWS/);
  const trading = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(trading, /LIVE_TRADING_LOCKED/);
});
