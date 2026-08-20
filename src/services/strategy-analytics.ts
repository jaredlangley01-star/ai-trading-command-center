export type StrategyHealth =
  | "NOT ENOUGH DATA"
  | "HEALTHY"
  | "WATCH"
  | "UNDERPERFORMING"
  | "PAUSE RECOMMENDED";

export function strategyHealth(
  metrics: {
    completed: number;
    totalRealizedPl: number;
    profitFactor: number;
    expectancy: number;
  },
  minimumSample = 20,
): StrategyHealth {
  if (metrics.completed < minimumSample) return "NOT ENOUGH DATA";
  if (
    metrics.totalRealizedPl > 0 &&
    metrics.profitFactor >= 1.25 &&
    metrics.expectancy > 0
  )
    return "HEALTHY";
  if (metrics.totalRealizedPl >= 0 && metrics.profitFactor >= 1) return "WATCH";
  if (metrics.profitFactor < 0.75 && metrics.expectancy < 0)
    return "PAUSE RECOMMENDED";
  return "UNDERPERFORMING";
}

export function calculateStrategyAnalytics(
  trades: Array<Record<string, unknown>>,
  minimumSample = 20,
) {
  const pnl = trades.map((trade) => Number(trade.net_pl ?? 0));
  const wins = pnl.filter((value) => value > 0);
  const losses = pnl.filter((value) => value < 0);
  const grossWins = wins.reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of pnl) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const durations = trades.map((trade) =>
    Math.max(
      0,
      Date.parse(String(trade.exit_timestamp)) -
        Date.parse(String(trade.entry_timestamp)),
    ),
  );
  const reasonCount = (reasons: string[]) =>
    trades.filter((trade) => reasons.includes(String(trade.exit_reason)))
      .length;
  const metrics = {
    completed: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    totalRealizedPl: pnl.reduce((sum, value) => sum + value, 0),
    averageWin: wins.length ? grossWins / wins.length : 0,
    averageLoss: losses.length ? -grossLosses / losses.length : 0,
    largestWin: wins.length ? Math.max(...wins) : 0,
    largestLoss: losses.length ? Math.min(...losses) : 0,
    profitFactor: grossLosses
      ? grossWins / grossLosses
      : grossWins > 0
        ? Number.POSITIVE_INFINITY
        : 0,
    expectancy: trades.length ? (grossWins - grossLosses) / trades.length : 0,
    maxDrawdown,
    averageDurationMinutes: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) /
        durations.length /
        60_000
      : 0,
    stopLossFrequency: trades.length
      ? (reasonCount(["STOP_LOSS"]) / trades.length) * 100
      : 0,
    takeProfitFrequency: trades.length
      ? (reasonCount(["TAKE_PROFIT"]) / trades.length) * 100
      : 0,
    endOfSessionExitFrequency: trades.length
      ? (reasonCount(["END_OF_SESSION"]) / trades.length) * 100
      : 0,
    signalExitFrequency: trades.length
      ? (reasonCount([
          "SIGNAL_WEAKENED",
          "SIGNAL_REVERSED",
          "STRATEGY_INVALIDATED",
        ]) /
          trades.length) *
        100
      : 0,
  };
  return {
    ...metrics,
    health: strategyHealth(metrics, minimumSample),
    minimumSample,
  };
}

export function livePaperStrategyPerformance(
  trades: Array<Record<string, unknown>>,
  minimumSample = 20,
) {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const trade of trades.filter(
    (row) => row.trade_origin === "AUTO_TRADER" && row.environment === "PAPER",
  )) {
    const name = String(trade.strategy_name ?? "Unattributed");
    groups.set(name, [...(groups.get(name) ?? []), trade]);
  }
  return Object.fromEntries(
    [...groups].map(([name, rows]) => [
      name,
      calculateStrategyAnalytics(rows, minimumSample),
    ]),
  );
}
