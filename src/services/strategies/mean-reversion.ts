import type { StrategySignal } from "../../domain/models.ts";
import {
  averageTrueRange,
  mean,
  standardDeviation,
  validCandles,
} from "./indicators.ts";
import {
  clampScore,
  noTrade,
  signalLevels,
  type StrategyInput,
  type StrategyModule,
} from "./types.ts";

export class MeanReversionStrategy implements StrategyModule {
  readonly name = "Mean Reversion";
  evaluate(input: StrategyInput): StrategySignal {
    if (!validCandles(input.candles, 20) || input.quote.last <= 0)
      return noTrade(input, this.name, "Invalid or insufficient market data.");
    const closes = input.candles.slice(-20).map((candle) => candle.close);
    const average = mean(closes);
    const deviation = standardDeviation(closes);
    const zScore = deviation > 0 ? (input.quote.last - average) / deviation : 0;
    if (Math.abs(zScore) < 1.5)
      return noTrade(
        input,
        this.name,
        "Price is not sufficiently displaced from its mean.",
      );
    const direction = zScore < 0 ? "BUY" : "SELL";
    return {
      symbol: input.asset.symbol,
      direction,
      strategyName: this.name,
      score: clampScore(50 + Math.abs(zScore) * 15),
      ...signalLevels(input, direction, averageTrueRange(input.candles), 1.5),
      reasoning: `Price is ${Math.abs(zScore).toFixed(1)} standard deviations ${zScore < 0 ? "below" : "above"} its 20-period mean.`,
      timestamp: input.timestamp,
    };
  }
}
