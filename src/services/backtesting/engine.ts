import type {
  Asset,
  HistoricalCandle,
  StrategySignal,
} from "../../domain/models.ts";
import { BreakoutStrategy } from "../strategies/breakout.ts";
import { MeanReversionStrategy } from "../strategies/mean-reversion.ts";
import { MomentumStrategy } from "../strategies/momentum.ts";
import { TrendFollowingStrategy } from "../strategies/trend-following.ts";
import {
  combineStrategySignals,
  defaultStrategies,
} from "../strategies/combined-opportunity-engine.ts";
import type { StrategyModule } from "../strategies/types.ts";
import type { BacktestTimeframe } from "./historical-data.ts";

export type BacktestStrategy =
  | "Momentum"
  | "Breakout"
  | "Trend Following"
  | "Mean Reversion"
  | "Combined Opportunity";
export type BacktestConfig = {
  strategy: BacktestStrategy;
  symbol: string;
  start: string;
  end: string;
  timeframe: BacktestTimeframe;
  startingCapital: number;
  riskProfile: "Conservative" | "Recommended" | "Aggressive";
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maximumConcurrentPositions: number;
  slippageBps: number;
  commissionPerTrade: number;
};
export type SimulatedTrade = {
  symbol: string;
  strategy: string;
  direction: "BUY" | "SELL";
  entryTimestamp: string;
  entryPrice: number;
  exitTimestamp: string;
  exitPrice: number;
  quantity: number;
  stop: number;
  target: number;
  grossPl: number;
  costs: number;
  netPl: number;
  returnPct: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "STRATEGY_EXIT" | "END_OF_DATA";
  durationMs: number;
};
export type BacktestResult = {
  metrics: Record<string, number>;
  equityCurve: Array<{ time: string; equity: number }>;
  drawdownCurve: Array<{ time: string; drawdown: number; drawdownPct: number }>;
  trades: SimulatedTrade[];
  assumptions: Record<string, string | number>;
};

const strategyFor = (name: BacktestStrategy): StrategyModule | null =>
  name === "Momentum"
    ? new MomentumStrategy()
    : name === "Breakout"
      ? new BreakoutStrategy()
      : name === "Trend Following"
        ? new TrendFollowingStrategy()
        : name === "Mean Reversion"
          ? new MeanReversionStrategy()
          : null;

function evaluate(
  config: BacktestConfig,
  asset: Asset,
  candles: HistoricalCandle[],
  index: number,
): StrategySignal {
  const visible = candles.slice(0, index + 1);
  const candle = visible.at(-1)!;
  const input = {
    asset,
    candles: visible,
    timestamp: candle.time,
    quote: {
      assetId: asset.id,
      bid: candle.close,
      ask: candle.close,
      last: candle.close,
      asOf: candle.time,
      source: "ALPACA_IEX_HISTORICAL",
      isDemo: false,
      isDelayed: false,
      provider: "ALPACA" as const,
      feed: "IEX",
    },
  };
  const strategyModule = strategyFor(config.strategy);
  if (strategyModule) return strategyModule.evaluate(input);
  const signals = defaultStrategies().map((strategy) =>
    strategy.evaluate(input),
  );
  const combined = combineStrategySignals(signals);
  const leader = combined.supporting.sort((a, b) => b.score - a.score)[0];
  return leader
    ? {
        ...leader,
        strategyName: "Combined Opportunity",
        direction: combined.direction,
        score: combined.score,
      }
    : {
        ...signals[0],
        strategyName: "Combined Opportunity",
        direction: "NO_TRADE",
        score: 0,
      };
}

export function runHistoricalBacktest(
  config: BacktestConfig,
  candles: HistoricalCandle[],
): BacktestResult {
  if (candles.length < 32) throw new Error("INSUFFICIENT_HISTORICAL_BARS");
  const asset: Asset = {
    id: config.symbol.toLowerCase(),
    symbol: config.symbol.toUpperCase(),
    name: config.symbol.toUpperCase(),
    assetClass: "EQUITY",
    currency: "USD",
  };
  let cash = config.startingCapital;
  let position: null | {
    direction: "BUY" | "SELL";
    entryTimestamp: string;
    entryPrice: number;
    quantity: number;
    stop: number;
    target: number;
    strategy: string;
  } = null;
  const trades: SimulatedTrade[] = [];
  const equityCurve: BacktestResult["equityCurve"] = [];
  const slip = config.slippageBps / 10_000;
  const closePosition = (
    candle: HistoricalCandle,
    rawPrice: number,
    reason: SimulatedTrade["exitReason"],
  ) => {
    if (!position) return;
    const exitPrice =
      rawPrice * (position.direction === "BUY" ? 1 - slip : 1 + slip);
    const grossPl =
      (exitPrice - position.entryPrice) *
      position.quantity *
      (position.direction === "BUY" ? 1 : -1);
    const costs = config.commissionPerTrade * 2;
    const netPl = grossPl - costs;
    cash += position.entryPrice * position.quantity + netPl;
    trades.push({
      symbol: asset.symbol,
      strategy: position.strategy,
      direction: position.direction,
      entryTimestamp: position.entryTimestamp,
      entryPrice: position.entryPrice,
      exitTimestamp: candle.time,
      exitPrice,
      quantity: position.quantity,
      stop: position.stop,
      target: position.target,
      grossPl,
      costs,
      netPl,
      returnPct: (netPl / (position.entryPrice * position.quantity)) * 100,
      exitReason: reason,
      durationMs: Date.parse(candle.time) - Date.parse(position.entryTimestamp),
    });
    position = null;
  };
  for (let i = 30; i < candles.length; i++) {
    const candle = candles[i];
    if (position) {
      const stopHit =
        position.direction === "BUY"
          ? candle.low <= position.stop
          : candle.high >= position.stop;
      const targetHit =
        position.direction === "BUY"
          ? candle.high >= position.target
          : candle.low <= position.target;
      if (stopHit) closePosition(candle, position.stop, "STOP_LOSS");
      else if (targetHit) closePosition(candle, position.target, "TAKE_PROFIT");
      else {
        const signal = evaluate(config, asset, candles, i);
        if (
          signal.direction !== "NO_TRADE" &&
          signal.direction !== position.direction
        )
          closePosition(candle, candle.close, "STRATEGY_EXIT");
      }
    } else if (i < candles.length - 1) {
      const signal = evaluate(config, asset, candles, i);
      if (signal.direction !== "NO_TRADE") {
        const next = candles[i + 1]; // Signal at close; entry on the next bar prevents look-ahead.
        const entryPrice =
          next.open * (signal.direction === "BUY" ? 1 + slip : 1 - slip);
        const allocation = Math.min(
          cash,
          cash * (config.positionSizePct / 100),
        );
        const quantity = Math.floor(allocation / entryPrice);
        if (quantity > 0) {
          const stop =
            signal.direction === "BUY"
              ? entryPrice * (1 - config.stopLossPct / 100)
              : entryPrice * (1 + config.stopLossPct / 100);
          const target =
            signal.direction === "BUY"
              ? entryPrice * (1 + config.takeProfitPct / 100)
              : entryPrice * (1 - config.takeProfitPct / 100);
          cash -= entryPrice * quantity;
          position = {
            direction: signal.direction,
            entryTimestamp: next.time,
            entryPrice,
            quantity,
            stop,
            target,
            strategy: config.strategy,
          };
          i++;
        }
      }
    }
    const marked = position
      ? cash +
        position.entryPrice * position.quantity +
        (candle.close - position.entryPrice) *
          position.quantity *
          (position.direction === "BUY" ? 1 : -1)
      : cash;
    equityCurve.push({ time: candle.time, equity: marked });
  }
  if (position)
    closePosition(candles.at(-1)!, candles.at(-1)!.close, "END_OF_DATA");
  if (!equityCurve.length || equityCurve.at(-1)!.equity !== cash)
    equityCurve.push({ time: candles.at(-1)!.time, equity: cash });
  return buildResult(config, trades, equityCurve);
}

function buildResult(
  config: BacktestConfig,
  trades: SimulatedTrade[],
  equityCurve: BacktestResult["equityCurve"],
): BacktestResult {
  let peak = config.startingCapital;
  const drawdownCurve = equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = peak - point.equity;
    return {
      time: point.time,
      drawdown,
      drawdownPct: peak ? (drawdown / peak) * 100 : 0,
    };
  });
  const wins = trades.filter((trade) => trade.netPl > 0),
    losses = trades.filter((trade) => trade.netPl < 0);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const endingCapital = equityCurve.at(-1)?.equity ?? config.startingCapital;
  const returns = trades.map((trade) => trade.returnPct / 100);
  const average = returns.length ? sum(returns) / returns.length : 0;
  const variance =
    returns.length > 1
      ? sum(returns.map((value) => (value - average) ** 2)) /
        (returns.length - 1)
      : 0;
  let winStreak = 0,
    lossStreak = 0,
    maxWinStreak = 0,
    maxLossStreak = 0;
  for (const trade of trades) {
    if (trade.netPl > 0) {
      winStreak++;
      lossStreak = 0;
    } else if (trade.netPl < 0) {
      lossStreak++;
      winStreak = 0;
    }
    maxWinStreak = Math.max(maxWinStreak, winStreak);
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
  }
  const grossWins = sum(wins.map((trade) => trade.netPl)),
    grossLosses = Math.abs(sum(losses.map((trade) => trade.netPl)));
  const metrics = {
    startingCapital: config.startingCapital,
    endingCapital,
    netProfitLoss: endingCapital - config.startingCapital,
    totalReturnPct:
      ((endingCapital - config.startingCapital) / config.startingCapital) * 100,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    averageWinningTrade: wins.length ? grossWins / wins.length : 0,
    averageLosingTrade: losses.length ? -grossLosses / losses.length : 0,
    largestWin: Math.max(0, ...wins.map((trade) => trade.netPl)),
    largestLoss: Math.min(0, ...losses.map((trade) => trade.netPl)),
    profitFactor: grossLosses
      ? grossWins / grossLosses
      : grossWins
        ? 999.99
        : 0,
    maximumDrawdown: Math.max(
      0,
      ...drawdownCurve.map((point) => point.drawdown),
    ),
    maximumDrawdownPct: Math.max(
      0,
      ...drawdownCurve.map((point) => point.drawdownPct),
    ),
    averageTradeReturn: average * 100,
    averageTradeDurationMs: trades.length
      ? sum(trades.map((trade) => trade.durationMs)) / trades.length
      : 0,
    averageRiskReward: trades.length
      ? sum(
          trades.map((trade) =>
            Math.abs(
              (trade.target - trade.entryPrice) /
                (trade.entryPrice - trade.stop),
            ),
          ),
        ) / trades.length
      : 0,
    longestWinningStreak: maxWinStreak,
    longestLosingStreak: maxLossStreak,
    sharpeRatio:
      variance > 0 ? (average / Math.sqrt(variance)) * Math.sqrt(252) : 0,
    expectancy: trades.length
      ? sum(trades.map((trade) => trade.netPl)) / trades.length
      : 0,
  };
  return {
    metrics,
    equityCurve,
    drawdownCurve,
    trades,
    assumptions: {
      dataSource: "ALPACA_IEX_HISTORICAL",
      signalTiming: "CANDLE_CLOSE_ENTRY_NEXT_OPEN",
      stopTargetCollision: "STOP_FIRST_CONSERVATIVE",
      slippageBps: config.slippageBps,
      commissionPerTrade: config.commissionPerTrade,
      positionSizePct: config.positionSizePct,
    },
  };
}
