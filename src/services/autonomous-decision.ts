export type MarketRegime =
  | "BULLISH"
  | "BEARISH"
  | "SIDEWAYS"
  | "HIGH_VOLATILITY"
  | "REDUCED_LIQUIDITY";
export type AutonomousCandidate = {
  symbol: string;
  direction: "BUY" | "SELL" | "NO_TRADE";
  strategy: string;
  strategyScore: number;
  opportunityScore: number;
  confidence: number;
  historicalScore: number;
  riskReward: number;
  regimeSuitability: number;
  quoteTimestamp: string;
  reasons: string[];
  marketRegime?: MarketRegime;
};
export function classifyMarketRegime(
  inputs: Array<{
    symbol: string;
    changePct: number;
    volatilityPct: number;
    relativeVolume?: number;
  }>,
): MarketRegime {
  if (!inputs.length) return "SIDEWAYS";
  const average = (key: "changePct" | "volatilityPct") =>
    inputs.reduce((sum, item) => sum + item[key], 0) / inputs.length;
  if (
    inputs.every((item) => item.relativeVolume != null) &&
    inputs.reduce((sum, item) => sum + Number(item.relativeVolume), 0) /
      inputs.length <
      0.55
  )
    return "REDUCED_LIQUIDITY";
  if (average("volatilityPct") >= 3) return "HIGH_VOLATILITY";
  if (average("changePct") >= 1) return "BULLISH";
  if (average("changePct") <= -1) return "BEARISH";
  return "SIDEWAYS";
}
export function regimeSuitability(
  strategy: string,
  direction: string,
  regime: MarketRegime,
) {
  if (regime === "REDUCED_LIQUIDITY") return 20;
  if (regime === "HIGH_VOLATILITY") return strategy === "Breakout" ? 70 : 45;
  if (regime === "SIDEWAYS")
    return strategy === "Mean Reversion"
      ? 90
      : strategy === "Trend Following"
        ? 35
        : 60;
  if (
    (regime === "BULLISH" && direction === "BUY") ||
    (regime === "BEARISH" && direction === "SELL")
  )
    return 95;
  return 45;
}
export function rankAutonomousCandidates(
  candidates: AutonomousCandidate[],
  config: {
    minimumOpportunityScore: number;
    minimumConfidence: number;
    minimumHistoricalScore: number;
    longEnabled: boolean;
    shortEnabled: boolean;
  },
  now = Date.now(),
) {
  return candidates
    .map((candidate) => {
      const rejected: string[] = [];
      if (candidate.direction === "NO_TRADE") rejected.push("NO_TRADE_SIGNAL");
      if (candidate.direction === "BUY" && !config.longEnabled)
        rejected.push("LONG_DISABLED");
      if (candidate.direction === "SELL" && !config.shortEnabled)
        rejected.push("SHORT_DISABLED");
      if (candidate.opportunityScore < config.minimumOpportunityScore)
        rejected.push("MINIMUM_OPPORTUNITY_SCORE");
      if (candidate.confidence < config.minimumConfidence)
        rejected.push("MINIMUM_CONFIDENCE");
      if (candidate.historicalScore < config.minimumHistoricalScore)
        rejected.push("INSUFFICIENT_HISTORICAL_EVIDENCE");
      if (candidate.regimeSuitability < 50)
        rejected.push("MARKET_REGIME_UNSUITABLE");
      if (now - Date.parse(candidate.quoteTimestamp) > 60_000)
        rejected.push("STALE_MARKET_DATA");
      const rankScore =
        candidate.opportunityScore * 0.4 +
        candidate.confidence * 0.2 +
        candidate.strategyScore * 0.15 +
        candidate.historicalScore * 0.1 +
        candidate.regimeSuitability * 0.1 +
        Math.min(100, candidate.riskReward * 25) * 0.05;
      return {
        ...candidate,
        rankScore: Math.round(rankScore * 100) / 100,
        decision: rejected.length
          ? ("REJECTED" as const)
          : ("ELIGIBLE" as const),
        rejectionReasons: rejected,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}
export function calculateRiskBasedSize(input: {
  equity: number;
  buyingPower: number;
  entry: number;
  stop: number;
  maximumLoss: number;
  maximumPosition: number;
  remainingPortfolioCapacity: number;
}) {
  const stopDistance = Math.abs(input.entry - input.stop);
  if (input.entry <= 0 || stopDistance <= 0)
    return {
      quantity: 0,
      capital: 0,
      maximumPlannedLoss: 0,
      reason: "INVALID_STOP_DISTANCE",
    };
  const lossQuantity = Math.floor(input.maximumLoss / stopDistance);
  const capitalCapacity = Math.max(
    0,
    Math.min(
      input.buyingPower,
      input.maximumPosition,
      input.remainingPortfolioCapacity,
    ),
  );
  const quantity = Math.max(
    0,
    Math.min(lossQuantity, Math.floor(capitalCapacity / input.entry)),
  );
  return {
    quantity,
    capital: quantity * input.entry,
    maximumPlannedLoss: quantity * stopDistance,
    reason: quantity ? "DETERMINISTIC_RISK_SIZE" : "INSUFFICIENT_RISK_CAPACITY",
  };
}
export function portfolioGate(input: {
  symbol: string;
  direction: "BUY" | "SELL";
  strategy: string;
  positions: Array<{
    symbol: string;
    direction: string;
    strategy?: string;
    exposure: number;
  }>;
  equity: number;
  maximumPortfolioExposurePct: number;
  maximumSymbolExposurePct: number;
  maximumConcurrentPositions: number;
}) {
  const reasons: string[] = [];
  if (input.positions.some((position) => position.symbol === input.symbol))
    reasons.push("DUPLICATE_POSITION");
  if (input.positions.length >= input.maximumConcurrentPositions)
    reasons.push("MAX_CONCURRENT_POSITIONS");
  const total = input.positions.reduce(
    (sum, position) => sum + position.exposure,
    0,
  );
  if (total >= (input.equity * input.maximumPortfolioExposurePct) / 100)
    reasons.push("MAX_PORTFOLIO_EXPOSURE");
  const symbol = input.positions
    .filter((p) => p.symbol === input.symbol)
    .reduce((sum, p) => sum + p.exposure, 0);
  if (symbol >= (input.equity * input.maximumSymbolExposurePct) / 100)
    reasons.push("MAX_SYMBOL_EXPOSURE");
  const similar = input.positions.filter(
    (p) => p.direction === input.direction && p.strategy === input.strategy,
  ).length;
  if (similar >= 2) reasons.push("STRATEGY_DIRECTION_CONCENTRATION");
  return {
    approved: reasons.length === 0,
    reasons,
    totalExposure: total,
    symbolExposure: symbol,
  };
}
