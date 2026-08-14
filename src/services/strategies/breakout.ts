import type { StrategySignal } from "../../domain/models.ts";
import { averageTrueRange, mean, validCandles } from "./indicators.ts";
import {
  clampScore,
  noTrade,
  signalLevels,
  type StrategyInput,
  type StrategyModule,
} from "./types.ts";

export class BreakoutStrategy implements StrategyModule {
  readonly name = "Breakout";
  evaluate(input: StrategyInput): StrategySignal {
    if (!validCandles(input.candles, 22) || input.quote.last <= 0)
      return noTrade(input, this.name, "Invalid or insufficient market data.");
    const prior = input.candles.slice(-21, -1);
    const high = Math.max(...prior.map((candle) => candle.high));
    const low = Math.min(...prior.map((candle) => candle.low));
    const last = input.quote.last;
    const currentVolume = input.candles.at(-1)?.volume ?? 0;
    const averageVolume = mean(prior.map((candle) => candle.volume));
    const direction = last > high ? "BUY" : last < low ? "SELL" : null;
    if (!direction)
      return noTrade(
        input,
        this.name,
        "Price remains inside the 20-period range.",
      );
    const boundary = direction === "BUY" ? high : low;
    const distancePct = Math.abs((last - boundary) / boundary) * 100;
    const volumeBoost = averageVolume > 0 ? currentVolume / averageVolume : 1;
    return {
      symbol: input.asset.symbol,
      direction,
      strategyName: this.name,
      score: clampScore(58 + distancePct * 10 + volumeBoost * 5),
      ...signalLevels(input, direction, averageTrueRange(input.candles)),
      reasoning: `${direction} breakout beyond the 20-period range with ${volumeBoost.toFixed(1)}× average volume.`,
      timestamp: input.timestamp,
    };
  }
}
