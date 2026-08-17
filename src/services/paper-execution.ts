export type PaperExecutionState =
  | "SUBMITTED"
  | "ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCELED";

export function normalizePaperExecutionStatus(
  status: unknown,
): PaperExecutionState {
  const value = String(status ?? "new").toLowerCase();
  if (value === "filled") return "FILLED";
  if (value === "partially_filled") return "PARTIALLY_FILLED";
  if (value === "rejected") return "REJECTED";
  if (value === "canceled" || value === "expired") return "CANCELED";
  if (value === "accepted" || value === "new" || value === "pending_new")
    return "ACCEPTED";
  return "SUBMITTED";
}

export function safePaperExecutionFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UPSTREAM_401" || message === "UPSTREAM_403")
    return {
      code: "BROKER_AUTH_FAILED",
      message: "Alpaca PAPER authentication failed.",
    };
  if (message === "UPSTREAM_422")
    return {
      code: "ORDER_REJECTED",
      message: "Alpaca rejected the PAPER order.",
    };
  if (message === "MARKET_CLOSED")
    return {
      code: "MARKET_CLOSED",
      message:
        "The US equity market is closed. The PAPER market order was not submitted.",
    };
  if (message === "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION")
    return {
      code: "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION",
      message:
        "PAPER market orders are unavailable in the current extended-hours session.",
    };
  if (message === "STALE_DATA")
    return {
      code: "STALE_DATA",
      message:
        "The latest Alpaca IEX quote exceeds the regular-session freshness limit.",
    };
  if (/timeout/i.test(message))
    return {
      code: "ORDER_TIMEOUT",
      message: "Alpaca PAPER submission timed out.",
    };
  return {
    code: "SYNC_FAILED",
    message: "Railway could not submit the PAPER order.",
  };
}
