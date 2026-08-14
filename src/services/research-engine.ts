import type {
  Asset,
  BigMoneyRecommendation,
  BigMoneyRiskProfile,
  CombinedOpportunity,
  RiskSettings,
} from "../domain/models.ts";

export interface ExternalResearchSource {
  name: string;
  research(asset: Asset): Promise<{ score: number; summary: string } | null>;
}

export class ResearchEngine {
  private readonly externalSources: ExternalResearchSource[];
  constructor(externalSources: ExternalResearchSource[] = []) {
    this.externalSources = externalSources;
  }

  async build(
    asset: Asset,
    opportunity: CombinedOpportunity,
    settings: RiskSettings,
    portfolioExposure: number,
    now = new Date(),
  ): Promise<BigMoneyRecommendation> {
    if (
      opportunity.finalRecommendation === "NO_TRADE" ||
      !opportunity.marketAnalysis ||
      !opportunity.marketDataTimestamp
    )
      throw new Error("RESEARCH_NO_TRADE");
    const external = await Promise.all(
      this.externalSources.map(async (source) => ({
        name: source.name,
        result: await source.research(asset),
      })),
    );
    const availableExternal = external.filter((item) => item.result);
    const unavailableResearch = [
      "LIVE_NEWS",
      "FUNDAMENTALS",
      "AI_RESEARCH",
    ].filter((name) => !availableExternal.some((item) => item.name === name));
    const strategyScore = opportunity.combinedScore;
    const conflictPenalty = opportunity.conflictingStrategies.length * 6;
    const researchScore = clamp(
      Math.round(
        strategyScore * 0.7 +
          Math.max(0, 20 - opportunity.marketAnalysis.volatility * 100) -
          conflictPenalty,
      ),
    );
    const price = opportunity.marketAnalysis.last;
    const direction = opportunity.finalRecommendation;
    const side = direction === "BUY" ? 1 : -1;
    const baseCapital = Math.min(
      settings.maximumCapitalPerTrade,
      Math.max(500, settings.maximumCapitalPerTrade * 0.75),
    );
    const profiles = [
      profile("Conservative", baseCapital * 0.6, price, side, 0.015, 0.03),
      profile("Recommended", baseCapital, price, side, 0.025, 0.055),
      profile("Aggressive", baseCapital * 1.25, price, side, 0.04, 0.09),
    ];
    const selected = profiles[1];
    const recommendationTimestamp = now.toISOString();
    const maxAge = Number(
      process.env.BIG_MONEY_RECOMMENDATION_MAX_AGE_MS ?? 1_800_000,
    );
    return {
      symbol: asset.symbol,
      direction,
      strategyScore,
      researchScore,
      currentPrice: price,
      recommendedEntry: price,
      recommendedCapital: selected.capital,
      recommendedStopLoss: selected.stopLoss,
      recommendedTakeProfit: selected.target,
      maximumPlannedLoss: selected.maximumPlannedLoss,
      riskReward: selected.riskReward,
      marketCondition: `${opportunity.marketAnalysis.trend} trend · ${opportunity.marketAnalysis.volatility.toFixed(2)} volatility`,
      supportingStrategies: opportunity.supportingStrategies,
      conflictingStrategies: opportunity.conflictingStrategies,
      reasoning: `${opportunity.supportingStrategies.join(", ") || "No strategy"} support the ${direction} setup. Conflicts: ${opportunity.conflictingStrategies.join(", ") || "none"}.`,
      dataSource: opportunity.dataSource,
      quoteTimestamp: opportunity.marketDataTimestamp,
      recommendationTimestamp,
      expiresAt: new Date(now.getTime() + maxAge).toISOString(),
      status: "PENDING",
      selectedRiskProfile: "Recommended",
      riskProfiles: profiles,
      portfolioExposure,
      unavailableResearch,
    };
  }
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const profile = (
  name: BigMoneyRiskProfile["name"],
  capital: number,
  price: number,
  side: number,
  stopPct: number,
  targetPct: number,
): BigMoneyRiskProfile => {
  const stopLoss = price * (1 - side * stopPct);
  const target = price * (1 + side * targetPct);
  const maximumPlannedLoss = (capital / price) * Math.abs(price - stopLoss);
  return {
    name,
    capital: round(capital),
    stopLoss: round(stopLoss),
    maximumPlannedLoss: round(maximumPlannedLoss),
    target: round(target),
    riskReward: round(Math.abs(target - price) / Math.abs(price - stopLoss)),
  };
};
const round = (value: number) => Math.round(value * 100) / 100;
