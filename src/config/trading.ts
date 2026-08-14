import type { AutoTraderConfig, RiskSettings } from "@/src/domain/models";
export const defaultRiskSettings: RiskSettings = {
  autoTraderEnabled: true,
  autoTraderAllocatedCapital: 25000,
  maximumCapitalPerTrade: 2500,
  maximumRiskPerTrade: 250,
  dailyMaximumLoss: 750,
  dailyProfitTarget: 1000,
  maximumTradesPerDay: 8,
  maximumConcurrentPositions: 4,
  maximumPortfolioExposure: 70,
  maximumPortfolioDrawdown: 12,
  maximumExposurePerAsset: 20,
  bigMoneyApprovalThreshold: 85,
};
export const defaultAutoTraderConfig: AutoTraderConfig = {
  enabled: false,
  capitalAllocation: 25000,
  maximumTradeSize: 2500,
  maximumRiskPerTrade: 250,
  dailyLossLimit: 750,
  dailyProfitTarget: 1000,
  maximumTradesPerDay: 8,
  maximumConcurrentPositions: 4,
  minimumStrategyScore: 70,
  allowedStrategies: [
    "Trend Following",
    "Momentum",
    "Breakout",
    "Mean Reversion",
  ],
  allowedAssets: ["AAPL", "NVDA", "MSFT", "AMZN"],
};
