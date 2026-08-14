import type {
  RiskDecision,
  RiskSettings,
  TradeRiskContext,
} from "../domain/models.ts";

const decision = (
  status: RiskDecision["status"],
  reason: string,
  context: TradeRiskContext,
  approvedCapital = 0,
): RiskDecision => ({
  status,
  reason,
  approvedCapital: Math.max(0, Math.floor(approvedCapital * 100) / 100),
  requestedCapital: context.requestedCapital,
  calculatedLoss: context.stopLoss
    ? Math.abs(context.expectedPrice - context.stopLoss) *
      (context.requestedCapital / context.expectedPrice)
    : 0,
});

export class ProductionRiskManager {
  private settings: RiskSettings;
  private recorder?: (
    context: TradeRiskContext,
    result: RiskDecision,
  ) => Promise<void>;
  constructor(
    settings: RiskSettings,
    recorder?: (
      context: TradeRiskContext,
      result: RiskDecision,
    ) => Promise<void>,
  ) {
    this.settings = settings;
    this.recorder = recorder;
  }

  async refresh() {}

  async evaluateOrder(context: TradeRiskContext): Promise<RiskDecision> {
    const result = this.calculate(context);
    await this.recorder?.(context, result);
    return result;
  }

  private calculate(context: TradeRiskContext): RiskDecision {
    if (context.expectedPrice <= 0 || context.requestedCapital <= 0)
      return decision("REJECTED", "INVALID_ORDER_VALUE", context);
    const calculatedLoss = context.stopLoss
      ? Math.abs(context.expectedPrice - context.stopLoss) *
        (context.requestedCapital / context.expectedPrice)
      : 0;
    if (context.emergencyStopActive)
      return decision("SYSTEM_LOCK", "EMERGENCY_STOP_ACTIVE", context);
    if (context.systemLocked)
      return decision("SYSTEM_LOCK", "SYSTEM_RISK_LOCKED", context);
    if (context.portfolioDrawdownPct >= this.settings.maximumPortfolioDrawdown)
      return decision("SYSTEM_LOCK", "MAX_PORTFOLIO_DRAWDOWN", context);
    if (context.source === "AUTO_TRADER") {
      if (!this.settings.autoTraderEnabled)
        return decision("DAILY_LOCK", "AUTO_TRADER_DISABLED", context);
      if (context.dailyLocked)
        return decision(
          "DAILY_LOCK",
          context.dailyLockReason ?? "DAILY_RISK_LOCK_ACTIVE",
          context,
        );
      if (context.dailyProfitLoss <= -this.settings.dailyMaximumLoss)
        return decision("DAILY_LOCK", "DAILY_LOSS_LIMIT_REACHED", context);
      if (context.dailyProfitLoss >= this.settings.dailyProfitTarget)
        return decision("DAILY_LOCK", "DAILY_PROFIT_TARGET_REACHED", context);
    }
    if (context.tradesToday >= this.settings.maximumTradesPerDay)
      return decision("DAILY_LOCK", "MAX_TRADES_PER_DAY", context);
    if (
      context.source === "BIG_MONEY" &&
      (context.recommendationScore ?? 0) <
        this.settings.bigMoneyApprovalThreshold
    )
      return decision("REJECTED", "BIG_MONEY_APPROVAL_REQUIRED", context);
    if (context.concurrentPositions >= this.settings.maximumConcurrentPositions)
      return decision("REJECTED", "MAX_CONCURRENT_POSITIONS", context);
    if (!context.stopLoss || calculatedLoss <= 0)
      return decision("REJECTED", "INSUFFICIENT_RISK_CAPACITY", context);

    const portfolioLimit =
      (context.portfolioValue * this.settings.maximumPortfolioExposure) / 100;
    const assetLimit =
      (context.portfolioValue * this.settings.maximumExposurePerAsset) / 100;
    const capacities = [
      this.settings.maximumCapitalPerTrade,
      context.source === "AUTO_TRADER"
        ? Math.max(
            0,
            this.settings.autoTraderAllocatedCapital -
              context.autoTraderExposure,
          )
        : Number.POSITIVE_INFINITY,
      Math.max(0, portfolioLimit - context.portfolioExposure),
      Math.max(0, assetLimit - context.assetExposure),
      calculatedLoss > 0
        ? (context.requestedCapital * this.settings.maximumRiskPerTrade) /
          calculatedLoss
        : 0,
    ];
    const approvedCapital = Math.min(...capacities);
    if (approvedCapital <= 0)
      return decision("REJECTED", "INSUFFICIENT_RISK_CAPACITY", context);
    if (approvedCapital < context.requestedCapital) {
      const reason =
        this.settings.maximumCapitalPerTrade < context.requestedCapital
          ? "MAX_POSITION_SIZE_EXCEEDED"
          : calculatedLoss > this.settings.maximumRiskPerTrade
            ? "MAX_LOSS_PER_TRADE_EXCEEDED"
            : context.source === "AUTO_TRADER" &&
                context.autoTraderExposure + context.requestedCapital >
                  this.settings.autoTraderAllocatedCapital
              ? "AUTO_TRADER_CAPITAL_ALLOCATION_EXCEEDED"
              : context.assetExposure + context.requestedCapital > assetLimit
                ? "MAX_ASSET_EXPOSURE_EXCEEDED"
                : "MAX_PORTFOLIO_EXPOSURE_EXCEEDED";
      return decision("REDUCE_SIZE", reason, context, approvedCapital);
    }
    return decision("APPROVED", "RISK_CHECKS_PASSED", context, approvedCapital);
  }
}

export function validateRiskSettings(value: RiskSettings) {
  const numericKeys: Array<Exclude<keyof RiskSettings, "autoTraderEnabled">> = [
    "autoTraderAllocatedCapital",
    "maximumCapitalPerTrade",
    "maximumRiskPerTrade",
    "dailyMaximumLoss",
    "dailyProfitTarget",
    "maximumTradesPerDay",
    "maximumConcurrentPositions",
    "maximumPortfolioExposure",
    "maximumPortfolioDrawdown",
    "maximumExposurePerAsset",
    "bigMoneyApprovalThreshold",
  ];
  return (
    typeof value.autoTraderEnabled === "boolean" &&
    numericKeys.every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        value[key] >= 0,
    ) &&
    value.maximumPortfolioExposure <= 100 &&
    value.maximumExposurePerAsset <= 100 &&
    value.maximumPortfolioDrawdown <= 100 &&
    value.bigMoneyApprovalThreshold <= 100
  );
}
