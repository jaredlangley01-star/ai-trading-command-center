export const defaultPaperTestUniverse = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMD",
  "AMZN",
  "META",
  "GOOGL",
  "TSLA",
  "SPY",
  "QQQ",
  "NFLX",
  "IWM",
];

export type PaperTestSettings = {
  enabled: boolean;
  targetAutoPositions: number;
  bigMoneyEnabled: boolean;
  targetBigMoneyPositions: number;
  bigMoneyAutoApprove: boolean;
  minimumOpportunityScore: number;
  minimumConfidence: number;
  maximumPositionSize: number;
  maximumRiskPerTrade: number;
  maximumDailyTrades: number;
  universe: string[];
};

export const defaultPaperTestSettings: PaperTestSettings = {
  enabled: false,
  targetAutoPositions: 8,
  bigMoneyEnabled: false,
  targetBigMoneyPositions: 2,
  bigMoneyAutoApprove: false,
  minimumOpportunityScore: 60,
  minimumConfidence: 50,
  maximumPositionSize: 1000,
  maximumRiskPerTrade: 100,
  maximumDailyTrades: 30,
  universe: defaultPaperTestUniverse,
};

export function assertPaperTestEnvironment(input: {
  mode?: string;
  brokerAdapter?: string;
  liveTradingEnabled?: string | boolean;
}) {
  if (
    input.mode !== "PAPER" ||
    input.brokerAdapter !== "ALPACA_PAPER" ||
    String(input.liveTradingEnabled).toLowerCase() === "true"
  )
    throw new Error("PAPER_TEST_LIVE_LOCKED");
}

export function availableTestSlots(
  target: number,
  confirmed: number,
  pending = 0,
) {
  return Math.max(0, Math.floor(target) - confirmed - pending);
}

export function confirmedBrokerPositions<
  T extends {
    broker_position_id?: string | null;
    broker_order_id?: string | null;
    status?: string;
  },
>(positions: T[]) {
  return positions.filter(
    (position) =>
      Boolean(position.broker_position_id || position.broker_order_id) &&
      ["OPEN", "EXIT_PENDING"].includes(String(position.status)),
  );
}

export function rankForTestCoverage<
  T extends {
    symbol: string;
    strategy: string;
    rankScore: number;
  },
>(
  candidates: T[],
  coverage: Record<string, number>,
  occupiedSymbols: string[],
) {
  const occupied = new Set(
    occupiedSymbols.map((symbol) => symbol.toUpperCase()),
  );
  return candidates
    .filter((candidate) => !occupied.has(candidate.symbol.toUpperCase()))
    .sort(
      (left, right) =>
        (coverage[left.strategy] ?? 0) - (coverage[right.strategy] ?? 0) ||
        right.rankScore - left.rankScore ||
        left.symbol.localeCompare(right.symbol),
    );
}

export function paperTestStatus(input: {
  enabled: boolean;
  sessionOpen: boolean;
  autoConfirmed: number;
  autoTarget: number;
}) {
  if (!input.enabled) return "OFF";
  if (!input.sessionOpen) return "WAITING_FOR_SESSION";
  return input.autoConfirmed >= input.autoTarget
    ? "TARGET_REACHED"
    : "SCANNING";
}

export function canAutoApproveBigMoneyTest(input: {
  settings: PaperTestSettings;
  mode: string;
  liveTradingEnabled: boolean;
  confirmedPositions: number;
  recommendationStatus: string;
  researchScore: number;
  requiredScore: number;
  researchAvailable: boolean;
}) {
  if (!input.settings.bigMoneyEnabled || !input.settings.bigMoneyAutoApprove)
    return { allowed: false, reason: "TEST_AUTO_APPROVAL_OFF" } as const;
  if (input.mode !== "PAPER" || input.liveTradingEnabled)
    return { allowed: false, reason: "PAPER_TEST_LIVE_LOCKED" } as const;
  if (input.confirmedPositions >= input.settings.targetBigMoneyPositions)
    return { allowed: false, reason: "BIG_MONEY_TEST_TARGET_REACHED" } as const;
  if (input.recommendationStatus !== "PENDING" || !input.researchAvailable)
    return { allowed: false, reason: "RESEARCH_NOT_QUALIFIED" } as const;
  if (input.researchScore < input.requiredScore)
    return { allowed: false, reason: "BIG_MONEY_SCORE_TOO_LOW" } as const;
  return { allowed: true, reason: "TEST_AUTO_APPROVAL_ELIGIBLE" } as const;
}
