export type PendingPaperOrder = {
  symbol?: string | null;
  direction?: string | null;
  status?: string | null;
  quantity?: unknown;
  filled_quantity?: unknown;
  limit_price?: unknown;
  order_type?: string | null;
};
export type PendingPaperOrderSummary =
  | { valid: true; reservedExposure: number; reservedBySymbol: Record<string, number>; activeOrderCount: number }
  | { valid: false; reason: string };

const positive = (value: unknown) =>
  (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value)) && Number(value) > 0;

/**
 * Reserves capital for broker orders that have not reached a terminal state.
 * Market orders without a known execution price fail closed until broker
 * synchronization resolves them; never silently treat them as zero exposure.
 */
export function summarizePendingPaperOrders(
  rows: PendingPaperOrder[] | null | undefined,
): PendingPaperOrderSummary {
  if (!Array.isArray(rows)) return { valid: false, reason: "PENDING_ORDERS_UNAVAILABLE" };
  const active = new Set(["QUEUED", "SUBMITTING", "SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"]);
  let reservedExposure = 0;
  let activeOrderCount = 0;
  const reservedBySymbol: Record<string, number> = {};
  for (const row of rows) {
    if (!active.has(String(row.status ?? "").toUpperCase())) continue;
    const symbol = String(row.symbol ?? "").trim().toUpperCase();
    const quantity = Number(row.quantity);
    const filled = Number(row.filled_quantity ?? 0);
    if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(filled) || filled < 0 || filled > quantity)
      return { valid: false, reason: "PENDING_ORDER_DATA_INVALID" };
    const remaining = quantity - filled;
    if (remaining <= 0) continue;
    if (String(row.order_type ?? "").toUpperCase() !== "LIMIT" || !positive(row.limit_price))
      return { valid: false, reason: "PENDING_MARKET_ORDER_PRICE_UNKNOWN" };
    const amount = remaining * Number(row.limit_price);
    if (!Number.isFinite(amount) || amount <= 0)
      return { valid: false, reason: "PENDING_ORDER_VALUE_INVALID" };
    reservedExposure += amount;
    reservedBySymbol[symbol] = (reservedBySymbol[symbol] ?? 0) + amount;
    activeOrderCount += 1;
  }
  return { valid: true, reservedExposure, reservedBySymbol, activeOrderCount };
}
