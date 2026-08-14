export type DiagnosticState =
  | "ONLINE"
  | "HEALTHY"
  | "DEGRADED"
  | "OFFLINE"
  | "NOT CONFIGURED"
  | "LOCKED";

export type DiagnosticCheck = {
  name: string;
  state: DiagnosticState;
  detail: string;
  lastHealthy: string | null;
};

export type WorkerHeartbeat = {
  last_seen_at?: string | null;
  status?: string | null;
  runtime?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const DIAGNOSTIC_HEARTBEAT_MAX_AGE_MS = 120_000;

export function heartbeatIsFresh(
  heartbeat: WorkerHeartbeat | null | undefined,
  now = Date.now(),
) {
  const seenAt = Date.parse(heartbeat?.last_seen_at ?? "");
  return (
    heartbeat?.status === "ONLINE" &&
    Number.isFinite(seenAt) &&
    now - seenAt < DIAGNOSTIC_HEARTBEAT_MAX_AGE_MS
  );
}

export function readTradingWorkerHealth(
  heartbeat: WorkerHeartbeat | null | undefined,
  now = Date.now(),
) {
  const online = heartbeatIsFresh(heartbeat, now);
  const metadata = heartbeat?.metadata ?? {};
  const hostedRuntime =
    online &&
    (heartbeat?.runtime === "HOSTED_PRODUCTION" ||
      metadata.runtime === "HOSTED_PRODUCTION");
  const liveLocked = metadata.safety === "LIVE_LOCKED";
  const paperBrokerConfigured =
    online && metadata.broker === "ALPACA_PAPER" && liveLocked;
  const paperBrokerHealthy =
    paperBrokerConfigured && metadata.accountStatus === "ACTIVE";
  const marketDataHealthy = online && metadata.marketData === "ALPACA_IEX";
  return {
    online,
    hostedRuntime,
    liveLocked,
    paperBrokerConfigured,
    paperBrokerHealthy,
    marketDataHealthy,
  };
}

export function safeDiagnosticError(check: string, code?: string) {
  return `${check} query failed${code ? ` (${code})` : ""}. No secrets were exposed.`;
}
