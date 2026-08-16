import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { getEnvironmentReadiness } from "@/src/config/environments";
import { getTradingRuntimeMode } from "@/src/config/runtime";
import {
  heartbeatIsFresh,
  readTradingWorkerHealth,
  safeDiagnosticError,
  type DiagnosticCheck,
  type DiagnosticState,
} from "@/src/services/diagnostics";

const expectedMigration = "202608140010_trade_016_final_production";
const safe = (
  name: string,
  state: DiagnosticState,
  detail: string,
  lastHealthy: string | null = null,
) => ({ name, state, detail, lastHealthy }) satisfies DiagnosticCheck;

const queryError = (name: string, error?: { code?: string } | null) =>
  error ? safe(name, "DEGRADED", safeDiagnosticError(name, error.code)) : null;

const failurePayload = (
  check: DiagnosticCheck,
  generatedAt: string,
  status: number,
) =>
  NextResponse.json(
    {
      summary: "NOT READY",
      checks: [check],
      paperReady: false,
      liveReady: false,
      liveLocked: true,
      schemaVersion: null,
      expectedMigration,
      generatedAt,
      nonTrading: true,
      error: check.detail,
    },
    { status },
  );

export async function GET() {
  const generatedAt = new Date().toISOString();
  try {
    const user = await getAuthenticatedOwner();
    if (!user)
      return failurePayload(
        safe(
          "Authentication",
          "OFFLINE",
          "Authenticated owner session is missing or expired.",
        ),
        generatedAt,
        401,
      );
    const db = await createSupabaseServerClient();
    if (!db)
      return failurePayload(
        safe(
          "Supabase",
          "OFFLINE",
          "Vercel Supabase server configuration is unavailable.",
        ),
        generatedAt,
        503,
      );
    const [worker, notification, migration, risk, positions] =
      await Promise.all([
        db
          .from("trading_worker_heartbeats")
          .select("last_seen_at,status,runtime,metadata")
          .eq("user_id", user.id)
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("notification_worker_heartbeats")
          .select("last_seen_at,status,metadata")
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
    const paper = getEnvironmentReadiness("PAPER"),
      live = getEnvironmentReadiness("LIVE"),
      vercelRuntime = getTradingRuntimeMode(),
      workerHealth = readTradingWorkerHealth(worker.data),
      notificationOnline = heartbeatIsFresh(notification.data),
      notificationConfigured =
        notification.data?.metadata?.pushConfigured !== false,
      paperConfigured =
        workerHealth.paperBrokerConfigured || paper.credentialsConfigured,
      paperHealthy = workerHealth.paperBrokerHealthy || paper.executionEnabled,
      marketDataHealthy =
        workerHealth.marketDataHealthy ||
        Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET),
      runtimeHealthy =
        workerHealth.hostedRuntime || vercelRuntime === "HOSTED_PRODUCTION";
    const databaseErrors = [
      queryError("Railway Trading Worker", worker.error),
      queryError("Railway Notification Worker", notification.error),
      queryError("Database migrations", migration.error),
      queryError("Risk Manager", risk.error),
      queryError("Position Protection", positions.error),
    ].filter(Boolean) as DiagnosticCheck[];
    const failedNames = new Set(databaseErrors.map((item) => item.name));
    const checks: DiagnosticCheck[] = [
      safe(
        "Vercel Web",
        "ONLINE",
        "Authenticated diagnostics endpoint responded.",
        generatedAt,
      ),
      ...(failedNames.has("Railway Trading Worker")
        ? []
        : [
            safe(
              "Railway Trading Worker",
              workerHealth.online ? "ONLINE" : "OFFLINE",
              workerHealth.online
                ? "Authenticated owner heartbeat is current."
                : "Heartbeat missing, stale, or not ONLINE.",
              worker.data?.last_seen_at ?? null,
            ),
          ]),
      ...(failedNames.has("Railway Notification Worker")
        ? []
        : [
            safe(
              "Railway Notification Worker",
              notificationOnline
                ? "ONLINE"
                : notification.data && !notificationConfigured
                  ? "NOT CONFIGURED"
                  : "OFFLINE",
              notificationOnline
                ? "Authenticated owner heartbeat is current."
                : notification.data && !notificationConfigured
                  ? "Worker is running, but VAPID push configuration is incomplete on Railway."
                  : "Heartbeat missing, stale, or not ONLINE.",
              notification.data?.last_seen_at ?? null,
            ),
          ]),
      safe(
        "Supabase",
        databaseErrors.length ? "DEGRADED" : "HEALTHY",
        databaseErrors.length
          ? `${databaseErrors.length} authenticated query check(s) failed.`
          : "Authenticated owner-scoped queries succeeded.",
        databaseErrors.length ? null : generatedAt,
      ),
      safe(
        "Alpaca Market Data",
        marketDataHealthy ? "HEALTHY" : "NOT CONFIGURED",
        workerHealth.marketDataHealthy
          ? "Railway heartbeat confirms Alpaca IEX. Credentials remain on Railway."
          : "No current Railway IEX health signal is available.",
        workerHealth.marketDataHealthy
          ? (worker.data?.last_seen_at ?? null)
          : null,
      ),
      safe(
        "Alpaca PAPER Broker",
        paperHealthy
          ? "HEALTHY"
          : paperConfigured
            ? "DEGRADED"
            : "NOT CONFIGURED",
        workerHealth.paperBrokerConfigured
          ? workerHealth.paperBrokerHealthy
            ? "Railway heartbeat confirms ALPACA_PAPER with an ACTIVE PAPER account."
            : "Railway confirms ALPACA_PAPER configuration, but the account is not ACTIVE."
          : paper.label,
        workerHealth.paperBrokerHealthy
          ? (worker.data?.last_seen_at ?? null)
          : null,
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
      ...(failedNames.has("Risk Manager")
        ? []
        : [
            safe(
              "Risk Manager",
              risk.data?.risk_state === "LOCKED" ? "LOCKED" : "HEALTHY",
              risk.data?.emergency_stop_active
                ? "Emergency Stop active."
                : "Risk controls available.",
            ),
            safe(
              "Auto Trader",
              risk.data?.auto_trader_status === "ACTIVE" ? "ONLINE" : "LOCKED",
              risk.data?.auto_trader_status ?? "PAUSED",
            ),
          ]),
      ...(failedNames.has("Position Protection")
        ? []
        : [
            safe(
              "Position Protection",
              workerHealth.online || !positions.count ? "HEALTHY" : "DEGRADED",
              positions.count
                ? `${positions.count} position(s) require Railway worker monitoring.`
                : "No open PAPER positions.",
              workerHealth.online ? (worker.data?.last_seen_at ?? null) : null,
            ),
          ]),
      ...(failedNames.has("Database migrations")
        ? []
        : [
            safe(
              "Database migrations",
              migration.data ? "HEALTHY" : "DEGRADED",
              migration.data
                ? `Applied through ${expectedMigration}.`
                : `Missing ${expectedMigration}.`,
            ),
          ]),
      safe(
        "Runtime",
        runtimeHealthy ? "HEALTHY" : "DEGRADED",
        workerHealth.hostedRuntime
          ? "Railway heartbeat confirms HOSTED_PRODUCTION."
          : vercelRuntime,
        workerHealth.hostedRuntime ? (worker.data?.last_seen_at ?? null) : null,
      ),
      ...databaseErrors,
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
      paperReady: paperHealthy && workerHealth.online,
      liveReady: live.credentialsConfigured && live.endpointValid,
      liveLocked: !live.executionEnabled,
      schemaVersion: migration.data?.version ?? null,
      expectedMigration,
      generatedAt,
      nonTrading: true,
      actionsPerformed: [
        "DATABASE_READ",
        "HEARTBEAT_READ",
        "CONFIGURATION_CHECK",
      ],
      secrets: "REDACTED",
    });
  } catch {
    return failurePayload(
      safe(
        "Diagnostics API",
        "OFFLINE",
        "The diagnostics route failed safely before completing all checks.",
      ),
      generatedAt,
      500,
    );
  }
}
