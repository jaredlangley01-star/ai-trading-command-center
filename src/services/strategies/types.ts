import type {
  Asset,
  HistoricalCandle,
  MarketQuote,
  StrategySignal,
} from "../../domain/models.ts";

export type StrategyInput = {
  asset: Asset;
  quote: MarketQuote;
  candles: HistoricalCandle[];
  timestamp: string;
};

export interface StrategyModule {
  readonly name: string;
  evaluate(input: StrategyInput): StrategySignal;
}

export const noTrade = (
  input: StrategyInput,
  strategyName: string,
  reasoning: string,
): StrategySignal => ({
  symbol: input.asset.symbol,
  direction: "NO_TRADE",
  strategyName,
  score: 0,
  entrySuggestion: null,
  stopLossSuggestion: null,
  takeProfitSuggestion: null,
  riskReward: null,
  reasoning,
  timestamp: input.timestamp,
});

export const clampScore = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

export function signalLevels(
  input: StrategyInput,
  direction: "BUY" | "SELL",
  stopDistance: number,
  rewardMultiple = 2,
) {
  const entry = input.quote.last;
  const distance = Math.max(stopDistance, entry * 0.005);
  return {
    entrySuggestion: entry,
    stopLossSuggestion:
      direction === "BUY" ? entry - distance : entry + distance,
    takeProfitSuggestion:
      direction === "BUY"
        ? entry + distance * rewardMultiple
        : entry - distance * rewardMultiple,
    riskReward: rewardMultiple,
  };
}
