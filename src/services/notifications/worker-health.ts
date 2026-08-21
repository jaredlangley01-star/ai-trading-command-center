export function classifyWorkerHealth(
  heartbeatAgeMs: number | null,
  lastEvent: string | null,
  staleAfterMs: number,
  recoveryAfterMs = Math.min(60_000, staleAfterMs / 3),
) {
  if (heartbeatAgeMs == null || heartbeatAgeMs > staleAfterMs)
    return "OFFLINE" as const;
  if (
    lastEvent === "TRADING_ENGINE_OFFLINE" &&
    heartbeatAgeMs > recoveryAfterMs
  )
    return "HYSTERESIS" as const;
  return "ONLINE" as const;
}
