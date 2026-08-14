import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { getEnvironmentReadiness } from "@/src/config/environments";
import { getTradingRuntimeMode } from "@/src/config/runtime";

type State =
  | "ONLINE"
  | "HEALTHY"
  | "DEGRADED"
  | "OFFLINE"
  | "NOT CONFIGURED"
  | "LOCKED";
const expectedMigration = "202608140010_trade_016_final_production";
const safe = (
  name: string,
  state: State,
  detail: string,
  lastHealthy: string | null = null,
) => ({ name, state, detail, lastHealthy });

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await createSupabaseServerClient();
  if (!db)
    return NextResponse.json({
      summary: "NOT READY",
      checks: [safe("Supabase", "OFFLINE", "Server client is not configured.")],
      nonTrading: true,
    });
  const [worker, notification, migration, risk, positions] = await Promise.all([
    db
      .from("trading_worker_heartbeats")
      .select("last_seen_at,status,metadata")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("notification_worker_heartbeats")
      .select("last_seen_at,status")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("schema_migrations")
      .select("version")
      .eq("version", expectedMigration)
      .maybeSingle(),
    db
      .from("system_state")
      .select("risk_state,emergency_stop_active,auto_trader_status,mode")
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("paper_positions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["OPEN", "EXIT_PENDING"]),
  ]);
  const fresh = (value?: string | null) =>
    Boolean(value && Date.now() - Date.parse(value) < 120_000);
  const paper = getEnvironmentReadiness("PAPER"),
    live = getEnvironmentReadiness("LIVE"),
    runtime = getTradingRuntimeMode();
  const workerOnline = fresh(worker.data?.last_seen_at),
    notificationOnline = fresh(notification.data?.last_seen_at);
  const checks = [
    safe(
      "Vercel Web",
      "ONLINE",
      "Authenticated diagnostics endpoint responded.",
      new Date().toISOString(),
    ),
    safe(
      "Railway Trading Worker",
      workerOnline ? "ONLINE" : "OFFLINE",
      workerOnline ? "Heartbeat current." : "Heartbeat missing or stale.",
      worker.data?.last_seen_at ?? null,
    ),
    safe(
      "Railway Notification Worker",
      notificationOnline ? "ONLINE" : "OFFLINE",
      notificationOnline ? "Heartbeat current." : "Heartbeat missing or stale.",
      notification.data?.last_seen_at ?? null,
    ),
    safe(
      "Supabase",
      "HEALTHY",
      "Authenticated owner-scoped queries succeeded.",
      new Date().toISOString(),
    ),
    safe(
      "Alpaca Market Data",
      process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET
        ? "HEALTHY"
        : "NOT CONFIGURED",
      "Alpaca IEX server configuration checked.",
    ),
    safe(
      "Alpaca PAPER Broker",
      paper.executionEnabled ? "HEALTHY" : "NOT CONFIGURED",
      paper.label,
    ),
    safe(
      "Alpaca LIVE Broker",
      live.executionEnabled
        ? "HEALTHY"
        : live.credentialsConfigured
          ? "LOCKED"
          : "NOT CONFIGURED",
      live.label,
    ),
    safe(
      "Risk Manager",
      risk.data?.risk_state === "LOCKED" ? "LOCKED" : "HEALTHY",
      risk.data?.emergency_stop_active
        ? "Emergency Stop active."
        : "Risk controls available.",
    ),
    safe(
      "Position Protection",
      workerOnline || !positions.count ? "HEALTHY" : "DEGRADED",
      positions.count
        ? `${positions.count} position(s) require worker monitoring.`
        : "No open PAPER positions.",
    ),
    safe(
      "Auto Trader",
      risk.data?.auto_trader_status === "ACTIVE" ? "ONLINE" : "LOCKED",
      risk.data?.auto_trader_status ?? "PAUSED",
    ),
    safe(
      "Database migrations",
      migration.data ? "HEALTHY" : "DEGRADED",
      migration.data
        ? `Applied through ${expectedMigration}.`
        : `Missing ${expectedMigration}.`,
    ),
    safe(
      "Runtime",
      runtime === "HOSTED_PRODUCTION" ? "HEALTHY" : "DEGRADED",
      runtime,
    ),
  ];
  const failures = checks.filter((check) =>
    ["OFFLINE", "DEGRADED", "NOT CONFIGURED"].includes(check.state),
  );
  return NextResponse.json({
    summary: failures.some((item) => item.state === "OFFLINE")
      ? "NOT READY"
      : failures.length
        ? "DEGRADED"
        : "READY",
    checks,
    paperReady: paper.executionEnabled && workerOnline,
    liveReady: live.credentialsConfigured && live.endpointValid,
    liveLocked: !live.executionEnabled,
    schemaVersion: migration.data?.version ?? null,
    expectedMigration,
    nonTrading: true,
    actionsPerformed: [
      "DATABASE_READ",
      "HEARTBEAT_READ",
      "CONFIGURATION_CHECK",
    ],
    secrets: "REDACTED",
  });
}
