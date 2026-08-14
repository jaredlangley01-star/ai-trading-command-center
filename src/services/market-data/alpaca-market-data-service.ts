import type {
  Asset,
  HistoricalCandle,
  MarketQuote,
} from "../../domain/models.ts";
import type { MarketDataService } from "../contracts.ts";

type Fetcher = typeof fetch;
type AlpacaConfig = {
  apiKey: string;
  apiSecret: string;
  feed: "iex";
  dataUrl: string;
  cacheMs: number;
};
type CacheEntry<T> = { expires: number; value: T };
type AlpacaSnapshot = {
  latestQuote?: { bp?: number; ap?: number; t?: string };
  latestTrade?: { p?: number; t?: string };
};

const sharedCache = new Map<string, CacheEntry<unknown>>();

export class AlpacaMarketDataError extends Error {
  readonly code: "ALPACA_DISCONNECTED" | "ALPACA_MALFORMED_RESPONSE";
  constructor(code: AlpacaMarketDataError["code"], message: string) {
    super(message);
    this.name = "AlpacaMarketDataError";
    this.code = code;
  }
}

export class AlpacaMarketDataService implements MarketDataService {
  private lastUpdated: string | null = null;
  private readonly config: AlpacaConfig;
  private readonly fetcher: Fetcher;
  constructor(config: AlpacaConfig, fetcher: Fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
    if (config.feed !== "iex")
      throw new AlpacaMarketDataError(
        "ALPACA_DISCONNECTED",
        "Only the Alpaca IEX equities feed is enabled.",
      );
  }

  async getQuote(asset: Asset): Promise<MarketQuote> {
    return (await this.getQuotes([asset]))[0];
  }

  async getQuotes(assets: Asset[]): Promise<MarketQuote[]> {
    const symbols = [
      ...new Set(assets.map((asset) => asset.symbol.toUpperCase())),
    ];
    if (!symbols.length) return [];
    const path = `/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`;
    const payload = await this.cached<Record<string, AlpacaSnapshot>>(path);
    return symbols.map((symbol) => {
      const snapshot = payload[symbol];
      const quote = snapshot?.latestQuote;
      const trade = snapshot?.latestTrade;
      if (!quote || !trade || !Number.isFinite(Number(trade.p)))
        throw new AlpacaMarketDataError(
          "ALPACA_MALFORMED_RESPONSE",
          `Alpaca did not return a valid IEX quote for ${symbol}.`,
        );
      const asOf = String(trade.t || quote.t || new Date().toISOString());
      this.lastUpdated = asOf;
      return {
        assetId: symbol.toLowerCase(),
        bid: Number(quote.bp ?? 0),
        ask: Number(quote.ap ?? 0),
        last: Number(trade.p),
        asOf,
        source: "ALPACA_IEX",
        isDemo: false,
        isDelayed: false,
        provider: "ALPACA",
        feed: "IEX",
      };
    });
  }

  async getHistoricalCandles(
    asset: Asset,
    duration: string,
    barSize: string,
  ): Promise<HistoricalCandle[]> {
    const timeframe = normalizeTimeframe(barSize);
    const start = new Date(Date.now() - durationMs(duration)).toISOString();
    const path = `/v2/stocks/${encodeURIComponent(asset.symbol.toUpperCase())}/bars?feed=iex&timeframe=${timeframe}&start=${encodeURIComponent(start)}&limit=1000&sort=asc`;
    const payload = await this.cached<{
      bars?: Array<Record<string, unknown>>;
    }>(path);
    return (payload.bars ?? []).map((bar) => ({
      time: String(bar.t),
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v),
    }));
  }

  async getHealth() {
    return {
      status: (this.lastUpdated ? "CONNECTED" : "DISCONNECTED") as
        | "CONNECTED"
        | "DISCONNECTED",
      provider: "Alpaca",
      feed: "IEX",
      lastUpdated: this.lastUpdated,
    };
  }

  private async cached<T>(path: string): Promise<T> {
    const key = `${this.config.dataUrl}${path}`;
    const hit = sharedCache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expires > Date.now()) return hit.value;
    let response: Response;
    try {
      response = await this.fetcher(key, {
        headers: {
          "APCA-API-KEY-ID": this.config.apiKey,
          "APCA-API-SECRET-KEY": this.config.apiSecret,
        },
        cache: "no-store",
      });
    } catch {
      throw new AlpacaMarketDataError(
        "ALPACA_DISCONNECTED",
        "Alpaca IEX market data is disconnected.",
      );
    }
    if (!response.ok)
      throw new AlpacaMarketDataError(
        "ALPACA_DISCONNECTED",
        `Alpaca IEX market data request failed (${response.status}).`,
      );
    const value = (await response.json()) as T;
    sharedCache.set(key, { expires: Date.now() + this.config.cacheMs, value });
    return value;
  }
}

export function createAlpacaMarketDataService(): AlpacaMarketDataService | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  const feed = (process.env.ALPACA_DATA_FEED ?? "iex").toLowerCase();
  if (feed !== "iex") return null;
  return new AlpacaMarketDataService({
    apiKey,
    apiSecret,
    feed: "iex",
    dataUrl: process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets",
    cacheMs: Number(process.env.ALPACA_MARKET_DATA_CACHE_MS ?? 5000),
  });
}

function normalizeTimeframe(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("day")) return "1Day";
  if (normalized.includes("hour")) return "1Hour";
  const minutes = Number.parseInt(normalized, 10);
  return `${Number.isFinite(minutes) && minutes > 0 ? minutes : 5}Min`;
}

function durationMs(value: string) {
  const amount = Number.parseInt(value, 10) || 1;
  const normalized = value.toUpperCase();
  if (normalized.includes("M") && !normalized.includes("MIN"))
    return amount * 30 * 86_400_000;
  if (normalized.includes("W")) return amount * 7 * 86_400_000;
  return amount * 86_400_000;
}
