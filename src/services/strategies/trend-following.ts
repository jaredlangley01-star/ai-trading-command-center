import type { StrategySignal } from "../../domain/models.ts";
import { averageTrueRange, mean, validCandles } from "./indicators.ts";
import {
  clampScore,
  noTrade,
  signalLevels,
  type StrategyInput,
  type StrategyModule,
} from "./types.ts";

export class TrendFollowingStrategy implements StrategyModule {
  readonly name = "Trend Following";
  evaluate(input: StrategyInput): StrategySignal {
    if (!validCandles(input.candles, 30) || input.quote.last <= 0)
      return noTrade(input, this.name, "Invalid or insufficient market data.");
    const closes = input.candles.map((candle) => candle.close);
    const fast = mean(closes.slice(-10));
    const slow = mean(closes.slice(-30));
    const spread = ((fast - slow) / slow) * 100;
    if (Math.abs(spread) < 0.25)
      return noTrade(input, this.name, "Moving averages show no clear trend.");
    const direction = spread > 0 ? "BUY" : "SELL";
    return {
      symbol: input.asset.symbol,
      direction,
      strategyName: this.name,
      score: clampScore(55 + Math.abs(spread) * 12),
      ...signalLevels(input, direction, averageTrueRange(input.candles) * 1.5),
      reasoning: `${direction === "BUY" ? "Uptrend" : "Downtrend"} confirmed by the 10/30-period moving-average spread.`,
      timestamp: input.timestamp,
    };
  }
}
