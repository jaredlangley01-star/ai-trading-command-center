import type {
  Asset,
  AutomatedDecisionResult,
  AutoTraderConfig,
  BrokerOrderRequest,
  CombinedOpportunity,
  TradeRiskContext,
} from "../domain/models.ts";
import type { BrokerService, RiskManager } from "./contracts.ts";
import { PaperOrderService } from "./broker/paper-order-service.ts";
import { RiskDecisionError } from "./broker/errors.ts";
import { TradePermissionService } from "./trade-permission.ts";
import { marketDataMaxAgeMs } from "./market-data/freshness.ts";

type OpportunityEngine = {
  evaluate(asset: Asset): Promise<CombinedOpportunity>;
};
type AutoTraderHooks = {
  claimOpportunity(
    key: string,
    opportunity: CombinedOpportunity,
  ): Promise<boolean>;
  buildRiskContext(order: BrokerOrderRequest): Promise<TradeRiskContext>;
  record(result: AutomatedDecisionResult): Promise<void>;
};

export class AutoTraderEngine {
  private opportunityEngine: OpportunityEngine;
  private riskManager: RiskManager;
  private permission: TradePermissionService;
  private broker: BrokerService;
  private executionSource: "ALPACA_PAPER" | "IBKR_PAPER" | "SIMULATED_PAPER";
  private config: AutoTraderConfig;
  private hooks: AutoTraderHooks;
  constructor(
    opportunityEngine: OpportunityEngine,
    riskManager: RiskManager,
    permission: TradePermissionService,
    broker: BrokerService,
    executionSource: "ALPACA_PAPER" | "IBKR_PAPER" | "SIMULATED_PAPER",
    config: AutoTraderConfig,
    hooks: AutoTraderHooks,
  ) {
    this.opportunityEngine = opportunityEngine;
    this.riskManager = riskManager;
    this.permission = permission;
    this.broker = broker;
    this.executionSource = executionSource;
    this.config = config;
    this.hooks = hooks;
  }

  async run(asset: Asset): Promise<AutomatedDecisionResult> {
    const opportunity = await this.opportunityEngine.evaluate(asset);
    const evaluatedAt = new Date().toISOString();
    const quoteTime = Date.parse(opportunity.marketDataTimestamp ?? "");
    const freshnessThresholdMs = opportunity.dataSource.includes("ALPACA")
      ? Math.max(marketDataMaxAgeMs(), 120_000)
      : marketDataMaxAgeMs();
    const ageMs = Number.isFinite(quoteTime)
      ? Math.max(0, Date.now() - quoteTime)
      : null;
    const marketDataAudit = {
      source: opportunity.dataSource,
      barTimestamp: opportunity.marketBarTimestamp ?? null,
      quoteTimestamp:
        opportunity.marketQuoteTimestamp ??
        opportunity.marketDataTimestamp ??
        null,
      tradeTimestamp: opportunity.marketTradeTimestamp ?? null,
      workerReceivedAt: opportunity.marketDataReceivedAt ?? evaluatedAt,
      candidateEvaluatedAt: evaluatedAt,
      ageMs,
      freshnessThresholdMs,
      state: (ageMs == null
        ? "UNAVAILABLE"
        : ageMs <= freshnessThresholdMs
          ? "FRESH"
          : "STALE") as "FRESH" | "STALE" | "UNAVAILABLE",
    };
    const bucket = new Date(opportunity.timestamp).toISOString().slice(0, 13);
    const key = `${asset.symbol}:${opportunity.finalRecommendation}:${opportunity.supportingStrategies.sort().join("+")}:${bucket}`;
    const base = {
      opportunityKey: key,
      symbol: asset.symbol,
      direction: opportunity.finalRecommendation,
      signalScore: opportunity.combinedScore,
      strategies: opportunity.supportingStrategies,
      timestamp: new Date().toISOString(),
      marketDataAudit,
    };
    const finish = async (
      values: Omit<
        AutomatedDecisionResult,
        keyof typeof base | "opportunityKey"
      >,
    ) => {
      const result = { ...base, ...values } as AutomatedDecisionResult;
      await this.hooks.record(result);
      return result;
    };
    if (!this.config.enabled || !this.permission.canTradeAutomatically())
      return finish({
        status: "LOCKED",
        reason: "AUTO_TRADER_PAUSED_OR_LOCKED",
        capital: 0,
        maximumPlannedLoss: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        executionSource: "NONE",
      });
    if (
      opportunity.dataSource === "UNAVAILABLE" ||
      (opportunity.marketDataTimestamp && !Number.isFinite(quoteTime))
    )
      return finish({
        status: "REJECTED",
        reason: "MARKET_DATA_DISCONNECTED",
        capital: 0,
        maximumPlannedLoss: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        executionSource: "NONE",
      });
    if (
      opportunity.marketDataTimestamp &&
      Date.now() - quoteTime > freshnessThresholdMs
    )
      return finish({
        status: "REJECTED",
        reason: "STALE_MARKET_DATA",
        capital: 0,
        maximumPlannedLoss: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        executionSource: "NONE",
      });
    if (
      opportunity.finalRecommendation === "NO_TRADE" ||
      opportunity.combinedScore < this.config.minimumStrategyScore
    )
      return finish({
        status: "SKIPPED",
        reason: "MINIMUM_SIGNAL_SCORE_NOT_MET",
        capital: 0,
        maximumPlannedLoss: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        executionSource: "NONE",
      });
    if (!this.config.allowedAssets.includes(asset.symbol))
      return finish({
        status: "SKIPPED",
        reason: "ASSET_NOT_ALLOWED",
        capital: 0,
        maximumPlannedLoss: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        executionSource: "NONE",
      });
    const signal = opportunity.signals
      .filter(
        (item) =>
          item.direction === opportunity.finalRecommendation &&
          this.config.allowedStrategies.includes(item.strategyName),
      )
      .sort((a, b) => b.score - a.score)[0];
    if (!signal)
      return finish({
        status: "SKIPPED",
        reason: "NO_ALLOWED_SUPPORTING_STRATEGY",
        capital: 0,
        maximumPlannedLoss: 0,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        executionSource: "NONE",
      });
    const entry = signal.entrySuggestion ?? 0;
    const stop = signal.stopLossSuggestion ?? 0;
    const target = signal.takeProfitSuggestion ?? 0;
    const isBuy = signal.direction === "BUY";
    if (entry <= 0 || stop <= 0 || (isBuy ? stop >= entry : stop <= entry))
      return finish({
        status: "REJECTED",
        reason: "INVALID_STOP_LOSS",
        capital: 0,
        maximumPlannedLoss: 0,
        entry,
        stopLoss: stop,
        takeProfit: target,
        executionSource: "NONE",
      });
    if (target <= 0 || (isBuy ? target <= entry : target >= entry))
      return finish({
        status: "REJECTED",
        reason: "INVALID_TAKE_PROFIT",
        capital: 0,
        maximumPlannedLoss: 0,
        entry,
        stopLoss: stop,
        takeProfit: target,
        executionSource: "NONE",
      });
    if (!(await this.hooks.claimOpportunity(key, opportunity)))
      return finish({
        status: "SKIPPED",
        reason: "DUPLICATE_OPPORTUNITY",
        capital: 0,
        maximumPlannedLoss: 0,
        entry,
        stopLoss: stop,
        takeProfit: target,
        executionSource: "NONE",
      });
    const riskSizedCapital =
      (this.config.maximumRiskPerTrade / Math.abs(entry - stop)) * entry;
    let capital = Math.min(
      this.config.maximumTradeSize,
      this.config.capitalAllocation,
      riskSizedCapital,
    );
    let quantity = Math.max(1, Math.floor(capital / entry));
    capital = quantity * entry;
    let order: BrokerOrderRequest = {
      symbol: asset.symbol,
      direction: signal.direction as "BUY" | "SELL",
      quantity,
      type: "LIMIT",
      limitPrice: entry,
      stopLoss: stop,
      takeProfit: target,
      source: "AUTO_TRADER",
      mode: "PAPER",
      confirmed: true,
      clientOrderId: key,
    };
    let context = await this.hooks.buildRiskContext(order);
    const service = new PaperOrderService(
      this.broker,
      this.riskManager,
      this.permission,
    );
    let reduced = false;
    try {
      const execution = await service.submit(order, context);
      return finish({
        status: reduced ? "REDUCED" : "EXECUTED",
        reason:
          this.executionSource === "SIMULATED_PAPER"
            ? "SIMULATED_PAPER_EXECUTION"
            : "RISK_AND_PERMISSION_APPROVED",
        capital,
        maximumPlannedLoss: Math.abs(entry - stop) * quantity,
        entry,
        stopLoss: stop,
        takeProfit: target,
        executionSource: this.executionSource,
        brokerOrderId: execution.brokerOrderId,
      });
    } catch (error) {
      if (
        error instanceof RiskDecisionError &&
        error.decision.status === "REDUCE_SIZE" &&
        error.decision.approvedCapital >= entry
      ) {
        reduced = true;
        quantity = Math.floor(error.decision.approvedCapital / entry);
        capital = quantity * entry;
        order = { ...order, quantity };
        context = { ...context, requestedCapital: capital };
        const execution = await service.submit(order, context);
        return finish({
          status: "REDUCED",
          reason: error.decision.reason,
          capital,
          maximumPlannedLoss: Math.abs(entry - stop) * quantity,
          entry,
          stopLoss: stop,
          takeProfit: target,
          executionSource: this.executionSource,
          brokerOrderId: execution.brokerOrderId,
        });
      }
      const locked =
        error instanceof RiskDecisionError &&
        ["DAILY_LOCK", "SYSTEM_LOCK"].includes(error.decision.status);
      return finish({
        status: locked ? "LOCKED" : "REJECTED",
        reason: error instanceof Error ? error.message : "AUTO_TRADER_REJECTED",
        capital,
        maximumPlannedLoss: Math.abs(entry - stop) * quantity,
        entry,
        stopLoss: stop,
        takeProfit: target,
        executionSource: "NONE",
      });
    }
  }
}
