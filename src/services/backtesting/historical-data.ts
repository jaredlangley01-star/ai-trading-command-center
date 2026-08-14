import type { HistoricalCandle } from "../../domain/models.ts";

export type BacktestTimeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

export async function fetchAlpacaHistoricalBars(
  symbol: string,
  start: string,
  end: string,
  timeframe: BacktestTimeframe,
  fetcher: typeof fetch = fetch,
): Promise<HistoricalCandle[]> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) throw new Error("ALPACA_HISTORICAL_DATA_NOT_CONFIGURED");
  const bars: HistoricalCandle[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      feed: "iex",
      timeframe,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      limit: "10000",
      sort: "asc",
    });
    if (pageToken) query.set("page_token", pageToken);
    const response = await fetcher(
      `${process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets"}/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?${query}`,
      {
        headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? "ALPACA_PLAN_HISTORICAL_DATA_UNAVAILABLE"
          : `ALPACA_HISTORICAL_DATA_${response.status}`,
      );
    const payload = (await response.json()) as {
      bars?: Array<Record<string, unknown>>;
      next_page_token?: string;
    };
    for (const bar of payload.bars ?? []) {
      const normalized = {
        time: String(bar.t),
        open: Number(bar.o),
        high: Number(bar.h),
        low: Number(bar.l),
        close: Number(bar.c),
        volume: Number(bar.v),
      };
      if (
        !Object.values(normalized).some(
          (value) => typeof value === "number" && !Number.isFinite(value),
        )
      )
        bars.push(normalized);
    }
    pageToken = payload.next_page_token || undefined;
  } while (pageToken);
  if (!bars.length) throw new Error("ALPACA_HISTORICAL_BARS_UNAVAILABLE");
  return bars;
}
