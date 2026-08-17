import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/src/lib/supabase/server";
import { getSupabaseProjectIdentity } from "@/src/lib/supabase/config";
import { getEnvironmentReadiness } from "@/src/config/environments";
import { getTradingRuntimeMode } from "@/src/config/runtime";
import {
  findMissingDiagnosticMigrations,
  heartbeatIsFresh,
  readTradingWorkerHealth,
  REQUIRED_DIAGNOSTIC_MIGRATIONS,
  migrationQueryFailureDetail,
  safeDiagnosticError,
  type DiagnosticCheck,
  type DiagnosticState,
} from "@/src/services/diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const expectedMigration = REQUIRED_DIAGNOSTIC_MIGRATIONS.at(-1)!;
const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
};
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
    { status, headers: noStoreHeaders },
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
    const migrationAdmin = createSupabaseAdminClient();
    const migrationDb = migrationAdmin ?? db;
    const [worker, notification, migration, risk, positions, executionQueue] =
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
        migrationDb
          .from("schema_migrations")
          .select("version")
          .order("version", { ascending: true }),
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
        db
          .from("paper_execution_requests")
          .select("status,queued_at,worker_received_at,completed_at")
          .eq("user_id", user.id)
          .in("status", [
            "QUEUED",
            "SUBMITTING",
            "SUBMITTED",
            "ACCEPTED",
            "PARTIALLY_FILLED",
          ])
          .order("queued_at", { ascending: true })
          .limit(250),
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
    const pendingExecutions = executionQueue.data ?? [];
    const unclaimedDelayed = pendingExecutions.filter(
      (request) =>
        request.status === "QUEUED" &&
        !request.worker_received_at &&
        Date.now() - Date.parse(request.queued_at) > 120_000,
    );
    const migrationVersions = (migration.data ?? []).flatMap(({ version }) =>
      typeof version === "string" ? [version] : [],
    );
    const missingMigrations = findMissingDiagnosticMigrations(migration.data);
    const project = getSupabaseProjectIdentity();
    const migrationTrace = {
      querySucceeded: !migration.error,
      client: migrationAdmin ? "SERVER_SERVICE_ROLE" : "AUTHENTICATED_ANON",
      rowCount: migration.error ? null : migrationVersions.length,
      returnedVersions: migration.error ? [] : migrationVersions,
      expectedVersions: [...REQUIRED_DIAGNOSTIC_MIGRATIONS],
      supabaseHostname: project.hostname,
      supabaseProjectRef: project.projectRef,
      errorCode: migration.error?.code ?? null,
      error: migration.error
        ? migrationQueryFailureDetail(migration.error)
        : null,
    };
    const databaseErrors = [
      queryError("Railway Trading Worker", worker.error),
      queryError("Railway Notification Worker", notification.error),
      migration.error
        ? safe(
            "Database migrations",
            "DEGRADED",
            migrationQueryFailureDetail(migration.error),
          )
        : null,
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
      safe(
        "Execution Queue",
        executionQueue.error || unclaimedDelayed.length
          ? "DEGRADED"
          : "HEALTHY",
        executionQueue.error
          ? "Owner-scoped execution queue metrics are unavailable."
          : `${pendingExecutions.length} pending request(s); ${unclaimedDelayed.length} delayed before worker claim. Accepted limit orders waiting for price do not degrade health.`,
        workerHealth.online ? (worker.data?.last_seen_at ?? null) : null,
      ),
      ...(failedNames.has("Database migrations")
        ? []
        : [
            safe(
              "Database migrations",
              missingMigrations.length ? "DEGRADED" : "HEALTHY",
              missingMigrations.length
                ? `Missing ${missingMigrations.join(", ")}.`
                : `Required schema migrations recorded through ${expectedMigration}.`,
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
    return NextResponse.json(
      {
        summary: failures.some((item) => item.state === "OFFLINE")
          ? "NOT READY"
          : failures.length
            ? "DEGRADED"
            : "READY",
        checks,
        paperReady: paperHealthy && workerHealth.online,
        liveReady: live.credentialsConfigured && live.endpointValid,
        liveLocked: !live.executionEnabled,
        schemaVersion: missingMigrations.length ? null : expectedMigration,
        expectedMigration,
        generatedAt,
        nonTrading: true,
        actionsPerformed: [
          "DATABASE_READ",
          "HEARTBEAT_READ",
          "CONFIGURATION_CHECK",
        ],
        secrets: "REDACTED",
        diagnosticTrace: { migrations: migrationTrace },
      },
      { headers: noStoreHeaders },
    );
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
