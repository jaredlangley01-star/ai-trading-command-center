import type { StrategySignal } from "../../domain/models.ts";
import {
  averageTrueRange,
  mean,
  percentageMomentum,
  validCandles,
} from "./indicators.ts";
import {
  clampScore,
  noTrade,
  signalLevels,
  type StrategyInput,
  type StrategyModule,
} from "./types.ts";

export class MomentumStrategy implements StrategyModule {
  readonly name = "Momentum";
  evaluate(input: StrategyInput): StrategySignal {
    if (!validCandles(input.candles, 20) || input.quote.last <= 0)
      return noTrade(input, this.name, "Invalid or insufficient market data.");
    const momentum = percentageMomentum(input.candles, 10);
    const recentVolume = mean(input.candles.slice(-5).map((c) => c.volume));
    const baselineVolume = mean(input.candles.slice(-20).map((c) => c.volume));
    if (Math.abs(momentum) < 1)
      return noTrade(
        input,
        this.name,
        "Price momentum is below the signal threshold.",
      );
    const direction = momentum > 0 ? "BUY" : "SELL";
    const volumeBoost = baselineVolume > 0 ? recentVolume / baselineVolume : 1;
    return {
      symbol: input.asset.symbol,
      direction,
      strategyName: this.name,
      score: clampScore(50 + Math.abs(momentum) * 7 + volumeBoost * 5),
      ...signalLevels(input, direction, averageTrueRange(input.candles) * 1.25),
      reasoning: `${Math.abs(momentum).toFixed(1)}% ten-period momentum with ${volumeBoost >= 1 ? "supportive" : "subdued"} relative volume.`,
      timestamp: input.timestamp,
    };
  }
}
