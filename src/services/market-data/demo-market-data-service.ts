import type {
  Asset,
  HistoricalCandle,
  MarketQuote,
} from "../../domain/models.ts";
import type { MarketDataService } from "../contracts.ts";

const bases: Record<string, number> = {
  AAPL: 227.42,
  NVDA: 184.16,
  MSFT: 521.3,
  AMZN: 230.98,
};

export class DemoMarketDataService implements MarketDataService {
  async getQuote(asset: Asset): Promise<MarketQuote> {
    const last = bases[asset.symbol] ?? 100;
    return {
      assetId: asset.id,
      bid: last - 0.05,
      ask: last + 0.05,
      last,
      asOf: new Date().toISOString(),
      source: "DEMO_PAPER_MARKET",
      isDemo: true,
      isDelayed: false,
      provider: "DEMO",
      feed: "SIMULATED",
    };
  }
  async getHistoricalCandles(asset: Asset): Promise<HistoricalCandle[]> {
    const base = bases[asset.symbol] ?? 100;
    return Array.from({ length: 45 }, (_, index) => {
      const trend = (index - 22) * 0.32;
      const wave = Math.sin(index / 3) * 1.4;
      const close = base - 7 + trend + wave;
      const time = new Date(Date.now() - (44 - index) * 86400000).toISOString();
      return {
        time,
        open: close - 0.35,
        high: close + 0.9,
        low: close - 0.85,
        close,
        volume: 900000 + index * 18000,
      };
    });
  }
}
