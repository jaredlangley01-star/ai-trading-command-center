import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  defaultNotificationPreferences,
  deepLink,
  redactNotificationPayload,
  shouldDeliver,
} from "../src/services/notifications/policy.ts";

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  if (!process.env[name]) throw new Error(`MISSING_ENV:${name}`);
if (process.env.TRADING_RUNTIME_MODE !== "HOSTED_PRODUCTION")
  throw new Error("HOSTED_PRODUCTION_REQUIRED");
const pushConfigured = Boolean(
  process.env.VAPID_SUBJECT &&
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY,
);
if (pushConfigured)
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const intervalMs = Math.max(
  10_000,
  Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 30_000),
);
const heartbeatStaleMs = Math.max(
  60_000,
  Number(process.env.TRADING_ENGINE_OFFLINE_AFTER_MS ?? 120_000),
);
let stopping = false;

async function enqueueHealthTransitions() {
  const { data: owners } = await db.from("profiles").select("id");
  for (const owner of owners ?? []) {
    const { data: heartbeat } = await db
      .from("trading_worker_heartbeats")
      .select("last_seen_at,status,metadata")
      .eq("user_id", owner.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const offline =
      !heartbeat?.last_seen_at ||
      Date.now() - Date.parse(heartbeat.last_seen_at) > heartbeatStaleMs;
    const { data: last } = await db
      .from("notification_events")
      .select("event_type")
      .eq("user_id", owner.id)
      .in("event_type", ["TRADING_ENGINE_OFFLINE", "TRADING_ENGINE_RECOVERED"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const type = offline
      ? "TRADING_ENGINE_OFFLINE"
      : "TRADING_ENGINE_RECOVERED";
    if (last?.event_type === type || (!offline && !last)) continue;
    const bucket = Math.floor(Date.now() / Math.max(heartbeatStaleMs, 60_000));
    await db.from("notification_events").upsert(
      {
        user_id: owner.id,
        event_type: type,
        category: "INFRASTRUCTURE",
        severity: offline ? "CRITICAL" : "INFO",
        title: offline ? "Trading Engine Offline" : "Trading Engine Recovered",
        body: offline
          ? "The hosted trading-engine heartbeat is stale. Existing broker-side PAPER orders are unchanged."
          : "The hosted trading engine heartbeat has recovered.",
        payload: { heartbeatLastSeen: heartbeat?.last_seen_at ?? null },
        deep_link: deepLink(type),
        dedupe_key: `health:${type}:${bucket}`,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
    if (heartbeat && !offline) {
      const brokerDown = heartbeat.metadata?.accountStatus !== "ACTIVE";
      const { data: lastBroker } = await db
        .from("notification_events")
        .select("event_type")
        .eq("user_id", owner.id)
        .in("event_type", ["BROKER_DISCONNECTED", "BROKER_RECOVERED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const brokerType = brokerDown
        ? "BROKER_DISCONNECTED"
        : "BROKER_RECOVERED";
      if (lastBroker?.event_type !== brokerType && (brokerDown || lastBroker)) {
        const hasPositions = Number(heartbeat.metadata?.positionCount ?? 0) > 0;
        await db.from("notification_events").upsert(
          {
            user_id: owner.id,
            event_type: brokerType,
            category: "INFRASTRUCTURE",
            severity: brokerDown && hasPositions ? "CRITICAL" : "WARNING",
            title: brokerDown
              ? "PAPER Broker Disconnected"
              : "PAPER Broker Recovered",
            body: brokerDown
              ? `The Alpaca PAPER account is unavailable${hasPositions ? " while positions exist" : ""}. Risk Manager remains enabled.`
              : "The Alpaca PAPER account connection recovered.",
            payload: {
              positionCount: Number(heartbeat.metadata?.positionCount ?? 0),
              accountStatus: heartbeat.metadata?.accountStatus ?? "UNKNOWN",
            },
            deep_link: "/?section=Paper%20Trading",
            dedupe_key: `broker:${brokerType}:${Math.floor(Date.now() / 60000)}`,
          },
          { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
        );
      }
    }
  }
}
async function deliverEvent(event) {
  if (!pushConfigured) {
    await db
      .from("notification_events")
      .update({
        status: "FAILED",
        suppression_reason: "VAPID_NOT_CONFIGURED",
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return;
  }
  const { data: preferenceRow } = await db
    .from("notification_preferences")
    .select("preferences")
    .eq("user_id", event.user_id)
    .maybeSingle();
  const preferences = {
    ...defaultNotificationPreferences,
    ...(preferenceRow?.preferences ?? {}),
    types: {
      ...defaultNotificationPreferences.types,
      ...(preferenceRow?.preferences?.types ?? {}),
    },
  };
  const policy = shouldDeliver(
    {
      type: event.event_type,
      severity: event.severity,
      opportunityScore: Number(event.payload?.opportunityScore ?? 0),
      createdAt: new Date(),
    },
    preferences,
  );
  if (!policy.deliver) {
    await db
      .from("notification_events")
      .update({
        status: "SUPPRESSED",
        suppression_reason: policy.reason,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return;
  }
  const cooldownKey = String(
    event.payload?.cooldownKey ??
      `${event.event_type}:${event.payload?.symbol ?? "global"}`,
  );
  const { data: cooldown } = await db
    .from("notification_cooldowns")
    .select("last_delivered_at")
    .eq("user_id", event.user_id)
    .eq("cooldown_key", cooldownKey)
    .maybeSingle();
  if (
    cooldown &&
    Date.now() - Date.parse(cooldown.last_delivered_at) <
      preferences.cooldownMinutes * 60_000
  ) {
    await db
      .from("notification_events")
      .update({
        status: "SUPPRESSED",
        suppression_reason: "COOLDOWN",
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return;
  }
  const { data: subscriptions } = await db
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", event.user_id)
    .eq("active", true);
  if (!subscriptions?.length) {
    await db
      .from("notification_events")
      .update({
        status: "FAILED",
        suppression_reason: "NO_ACTIVE_SUBSCRIPTION",
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return;
  }
  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title: event.title,
          body: event.body,
          url: event.deep_link,
          tag: event.dedupe_key,
          data: redactNotificationPayload(event.payload ?? {}),
        }),
      );
      delivered += 1;
      await db.from("notification_delivery_attempts").insert({
        user_id: event.user_id,
        event_id: event.id,
        subscription_id: subscription.id,
        status: "DELIVERED",
        provider_status: 201,
      });
    } catch (error) {
      const status = Number(error?.statusCode ?? 0);
      await db.from("notification_delivery_attempts").insert({
        user_id: event.user_id,
        event_id: event.id,
        subscription_id: subscription.id,
        status: "FAILED",
        provider_status: status || null,
        error_code: status ? `WEB_PUSH_${status}` : "WEB_PUSH_FAILURE",
      });
      if (status === 404 || status === 410)
        await db
          .from("push_subscriptions")
          .update({ active: false })
          .eq("id", subscription.id);
    }
  }
  const status =
    delivered === subscriptions.length
      ? "DELIVERED"
      : delivered
        ? "PARTIAL"
        : "FAILED";
  await db
    .from("notification_events")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", event.id);
  if (delivered)
    await db.from("notification_cooldowns").upsert({
      user_id: event.user_id,
      cooldown_key: cooldownKey,
      last_delivered_at: new Date().toISOString(),
      event_id: event.id,
    });
}
async function cycle() {
  const { data: owners } = await db.from("profiles").select("id");
  for (const owner of owners ?? [])
    await db.from("notification_worker_heartbeats").upsert(
      {
        user_id: owner.id,
        worker_id:
          process.env.NOTIFICATION_WORKER_ID ?? "railway-notification-worker",
        status: pushConfigured ? "ONLINE" : "ERROR",
        last_seen_at: new Date().toISOString(),
        version: process.env.WORKER_VERSION ?? "TRADE-016",
        metadata: {
          runtime: "HOSTED_PRODUCTION",
          execution: "NONE",
          pushConfigured,
          queueProcessing: true,
        },
      },
      { onConflict: "user_id,worker_id" },
    );
  await enqueueHealthTransitions();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("notification_events")
    .update({ status: "QUEUED", suppression_reason: "WORKER_RESTART_RECOVERY" })
    .eq("status", "PROCESSING")
    .lt("processed_at", stale);
  const { data: events } = await db
    .from("notification_events")
    .select("*")
    .eq("status", "QUEUED")
    .lte("available_at", new Date().toISOString())
    .order("created_at")
    .limit(20);
  for (const event of events ?? []) {
    const { data: claimed } = await db
      .from("notification_events")
      .update({ status: "PROCESSING", processed_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("status", "QUEUED")
      .select("id")
      .maybeSingle();
    if (claimed)
      await deliverEvent(event).catch(async () =>
        db
          .from("notification_events")
          .update({
            status: "FAILED",
            suppression_reason: "PROVIDER_FAILURE",
            processed_at: new Date().toISOString(),
          })
          .eq("id", event.id),
      );
  }
}
async function loop() {
  try {
    await cycle();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "notification_cycle_failed",
        message: error instanceof Error ? error.message : "UNKNOWN",
      }),
    );
  }
  if (!stopping) setTimeout(loop, intervalMs);
}
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
void loop();
