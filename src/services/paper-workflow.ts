export type TradeOrigin = "BIG_MONEY" | "AUTO_TRADER" | "MANUAL" | "STANDARD";
export type TradeClassification = "BIG" | "SMALL" | "STANDARD";

export function normalizeTradeOrigin(value: unknown): TradeOrigin {
  const origin = String(value ?? "").toUpperCase();
  if (origin === "BIG_MONEY") return "BIG_MONEY";
  if (origin === "AUTO_TRADER") return "AUTO_TRADER";
  if (origin === "MANUAL") return "MANUAL";
  return "STANDARD";
}

export function classifyTradeOrigin(value: unknown): TradeClassification {
  const origin = normalizeTradeOrigin(value);
  if (origin === "BIG_MONEY") return "BIG";
  if (origin === "AUTO_TRADER") return "SMALL";
  return "STANDARD";
}

export function activeTradeSummary(positions: Array<Record<string, unknown>>) {
  return positions.reduce<{
    active: number;
    big: number;
    small: number;
    standard: number;
    capital: number;
    openPl: number;
  }>(
    (summary, position) => {
      const classification = classifyTradeOrigin(position.trade_origin);
      summary.active += 1;
      summary.capital += Math.abs(Number(position.market_value ?? 0));
      summary.openPl += Number(position.unrealized_pl ?? 0);
      if (classification === "BIG") summary.big += 1;
      else if (classification === "SMALL") summary.small += 1;
      else summary.standard += 1;
      return summary;
    },
    { active: 0, big: 0, small: 0, standard: 0, capital: 0, openPl: 0 },
  );
}

export function journalSummary(trades: Array<Record<string, unknown>>) {
  const values = trades.map((trade) => Number(trade.net_pl ?? 0));
  const returns = trades.map((trade) => Number(trade.return_pct ?? 0));
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    completed: values.length,
    wins: wins.length,
    losses: losses.length,
    winRate: values.length ? (wins.length / values.length) * 100 : 0,
    totalRealizedPl: total,
    averageWin: wins.length
      ? wins.reduce((sum, value) => sum + value, 0) / wins.length
      : 0,
    averageLoss: losses.length
      ? losses.reduce((sum, value) => sum + value, 0) / losses.length
      : 0,
    largestWin: wins.length ? Math.max(...wins) : 0,
    largestLoss: losses.length ? Math.min(...losses) : 0,
    averageReturn: returns.length
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : 0,
  };
}

export function strategyPerformance(trades: Array<Record<string, unknown>>) {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const trade of trades) {
    const name = String(trade.strategy_name ?? "Unattributed");
    groups.set(name, [...(groups.get(name) ?? []), trade]);
  }
  return Object.fromEntries(
    [...groups].map(([name, rows]) => [name, journalSummary(rows)]),
  );
}

export function newManualRequestId() {
  return crypto.randomUUID();
}

export function projectPaperLifecycle(input: {
  symbol: string;
  origin: TradeOrigin;
  strategy: string;
  direction: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  exitPrice: number;
}) {
  const multiplier = input.direction === "SHORT" ? -1 : 1;
  const netPl =
    (input.exitPrice - input.entryPrice) * input.quantity * multiplier;
  const trade = {
    symbol: input.symbol,
    trade_origin: input.origin,
    classification: classifyTradeOrigin(input.origin),
    strategy_name: input.strategy,
    direction: input.direction,
    quantity: input.quantity,
    entry_price: input.entryPrice,
    exit_price: input.exitPrice,
    net_pl: netPl,
    return_pct:
      input.entryPrice * input.quantity > 0
        ? (netPl / (input.entryPrice * input.quantity)) * 100
        : 0,
    environment: "PAPER",
  };
  return {
    acceptedOrder: { mode: "PAPER", origin: input.origin },
    openPosition: {
      symbol: input.symbol,
      trade_origin: input.origin,
      market_value: input.entryPrice * input.quantity,
      unrealized_pl: 0,
    },
    journal: trade,
    strategy: strategyPerformance([trade]),
    notifications: ["TRADE_OPENED", "TRADE_CLOSED"],
  };
}
