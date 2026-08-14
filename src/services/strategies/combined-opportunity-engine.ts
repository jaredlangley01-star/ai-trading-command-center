import type {
  Asset,
  CombinedOpportunity,
  StrategyDirection,
} from "../../domain/models.ts";
import { MarketDataEngine } from "../market-data-engine.ts";
import { mean, percentageMomentum, realizedVolatility } from "./indicators.ts";
import { BreakoutStrategy } from "./breakout.ts";
import { MeanReversionStrategy } from "./mean-reversion.ts";
import { MomentumStrategy } from "./momentum.ts";
import { TrendFollowingStrategy } from "./trend-following.ts";
import type { StrategyModule } from "./types.ts";

export const defaultStrategies = () => [
  new TrendFollowingStrategy(),
  new MomentumStrategy(),
  new BreakoutStrategy(),
  new MeanReversionStrategy(),
];

export class CombinedOpportunityEngine {
  private marketData: MarketDataEngine;
  private strategies: StrategyModule[];
  constructor(
    marketData: MarketDataEngine,
    strategies: StrategyModule[] = defaultStrategies(),
  ) {
    this.marketData = marketData;
    this.strategies = strategies;
  }

  async evaluate(asset: Asset): Promise<CombinedOpportunity> {
    const timestamp = new Date().toISOString();
    const snapshot = await this.marketData.snapshot(asset, "2 M", "1 day");
    if (!snapshot.quote) {
      const signals = this.strategies.map((strategy) =>
        strategy.evaluate({
          asset,
          quote: {
            assetId: asset.id,
            bid: 0,
            ask: 0,
            last: 0,
            asOf: timestamp,
            source: "UNAVAILABLE",
            isDemo: true,
            isDelayed: false,
            provider: "DEMO",
            feed: "UNAVAILABLE",
          },
          candles: [],
          timestamp,
        }),
      );
      return {
        symbol: asset.symbol,
        supportingStrategies: [],
        conflictingStrategies: [],
        combinedScore: 0,
        finalRecommendation: "NO_TRADE",
        signals,
        timestamp,
        dataSource: "UNAVAILABLE",
        marketDataTimestamp: undefined,
        marketAnalysis: null,
      };
    }
    const input = {
      asset,
      quote: snapshot.quote,
      candles: snapshot.candles,
      timestamp,
    };
    const signals = this.strategies.map((strategy) => strategy.evaluate(input));
    const buys = signals.filter((signal) => signal.direction === "BUY");
    const sells = signals.filter((signal) => signal.direction === "SELL");
    const buyWeight = buys.reduce((sum, signal) => sum + signal.score, 0);
    const sellWeight = sells.reduce((sum, signal) => sum + signal.score, 0);
    let finalRecommendation: StrategyDirection = "NO_TRADE";
    const difference = Math.abs(buyWeight - sellWeight);
    if (difference >= 15 && Math.max(buyWeight, sellWeight) >= 55)
      finalRecommendation = buyWeight > sellWeight ? "BUY" : "SELL";
    const supporting =
      finalRecommendation === "BUY"
        ? buys
        : finalRecommendation === "SELL"
          ? sells
          : [];
    const conflicting =
      finalRecommendation === "BUY"
        ? sells
        : finalRecommendation === "SELL"
          ? buys
          : [...buys, ...sells];
    const dominantWeight = Math.max(buyWeight, sellWeight);
    const combinedScore =
      finalRecommendation === "NO_TRADE"
        ? Math.min(50, Math.round(difference / Math.max(1, signals.length)))
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(
                dominantWeight / Math.max(1, supporting.length) -
                  Math.min(buyWeight, sellWeight) /
                    Math.max(1, conflicting.length) /
                    2,
              ),
            ),
          );
    const closes = snapshot.candles.map((candle) => candle.close);
    const shortAverage = closes.length ? mean(closes.slice(-10)) : 0;
    const longAverage = closes.length ? mean(closes.slice(-30)) : 0;
    return {
      symbol: asset.symbol,
      supportingStrategies: supporting.map((signal) => signal.strategyName),
      conflictingStrategies: conflicting.map((signal) => signal.strategyName),
      combinedScore,
      finalRecommendation,
      signals,
      timestamp,
      dataSource: snapshot.quote.isDemo
        ? "DEMO DATA"
        : snapshot.quote.provider === "ALPACA"
          ? "ALPACA — IEX"
          : snapshot.quote.isDelayed
            ? "IBKR PAPER — DELAYED"
            : "IBKR PAPER DATA",
      marketDataTimestamp: snapshot.quote.asOf,
      marketAnalysis: {
        bid: snapshot.quote.bid,
        ask: snapshot.quote.ask,
        last: snapshot.quote.last,
        volatility: realizedVolatility(snapshot.candles),
        trend:
          shortAverage > longAverage
            ? "UP"
            : shortAverage < longAverage
              ? "DOWN"
              : "FLAT",
        momentum: percentageMomentum(snapshot.candles),
      },
    };
  }
}
