export type PaperPortfolioSnapshot = {
  source?: string | null;
  equity?: unknown;
  cash?: unknown;
  buying_power?: unknown;
  open_exposure?: unknown;
  position_count?: unknown;
  as_of?: string | null;
};
export type PaperPositionSnapshot = {
  symbol?: string | null;
  quantity?: unknown;
  current_price?: unknown;
  entry_price?: unknown;
  last_synced_at?: string | null;
};
export type PaperRiskSnapshotValidation =
  | { valid: true; portfolioValue: number; portfolioExposure: number }
  | { valid: false; reason: string };

const finiteNonNegative = (value: unknown) =>
  typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number.isFinite(Number(value)) && Number(value) >= 0
    : false;

export function validatePaperRiskSnapshot(
  portfolio: PaperPortfolioSnapshot | null | undefined,
  positions: PaperPositionSnapshot[] | null | undefined,
  options: { now?: number; maxAgeMs?: number } = {},
): PaperRiskSnapshotValidation {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 180_000;
  if (!portfolio || !Array.isArray(positions))
    return { valid: false, reason: "BROKER_SNAPSHOT_MISSING" };
  if (portfolio.source !== "ALPACA_PAPER")
    return { valid: false, reason: "BROKER_SNAPSHOT_SOURCE_INVALID" };
  for (const field of ["equity", "cash", "buying_power", "open_exposure"] as const) {
    if (!finiteNonNegative(portfolio[field]))
      return { valid: false, reason: "BROKER_ACCOUNT_VALUE_INVALID" };
  }
  const equity = Number(portfolio.equity);
  if (equity <= 0)
    return { valid: false, reason: "BROKER_EQUITY_INVALID" };
  const snapshotTime = portfolio.as_of ? Date.parse(portfolio.as_of) : NaN;
  if (!Number.isFinite(snapshotTime) || snapshotTime > now + 30_000 || now - snapshotTime > maxAgeMs)
    return { valid: false, reason: "BROKER_PORTFOLIO_SNAPSHOT_STALE" };
  if (!Number.isInteger(Number(portfolio.position_count)) || Number(portfolio.position_count) !== positions.length)
    return { valid: false, reason: "BROKER_POSITION_COUNT_MISMATCH" };

  let exposure = 0;
  for (const position of positions) {
    const quantity = Number(position.quantity);
    const price = Number(position.current_price ?? position.entry_price);
    const syncedAt = position.last_synced_at ? Date.parse(position.last_synced_at) : NaN;
    if (!position.symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0)
      return { valid: false, reason: "BROKER_POSITION_VALUE_INVALID" };
    if (!Number.isFinite(syncedAt) || syncedAt > now + 30_000 || now - syncedAt > maxAgeMs)
      return { valid: false, reason: "BROKER_POSITION_SNAPSHOT_STALE" };
    exposure += quantity * price;
  }
  const reportedExposure = Number(portfolio.open_exposure);
  const tolerance = Math.max(1, reportedExposure * 0.01);
  if (Math.abs(exposure - reportedExposure) > tolerance)
    return { valid: false, reason: "BROKER_EXPOSURE_MISMATCH" };
  return { valid: true, portfolioValue: equity, portfolioExposure: exposure };
}
