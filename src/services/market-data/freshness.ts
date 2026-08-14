import type { MarketQuote } from "../../domain/models.ts";

export const marketDataMaxAgeMs = () =>
  Math.max(1000, Number(process.env.MARKET_DATA_MAX_AGE_MS ?? 30000));

export function assertFreshMarketQuote(
  quote: MarketQuote | null,
  now = Date.now(),
  maxAgeMs = marketDataMaxAgeMs(),
) {
  if (!quote) throw new Error("MARKET_DATA_DISCONNECTED");
  const timestamp = Date.parse(quote.asOf);
  if (!Number.isFinite(timestamp) || now - timestamp > maxAgeMs)
    throw new Error("STALE_MARKET_DATA");
  return { ageMs: Math.max(0, now - timestamp), timestamp: quote.asOf };
}
