import type {
  Asset,
  BrokerOrderRequest,
  BrokerOrderResult,
  HistoricalCandle,
  MarketQuote,
  TradingStrategy,
  TradeRiskContext,
} from "@/src/domain/models";
import type {
  MarketDataService,
  BrokerService,
  RiskManager,
  StrategyEngine,
} from "@/src/services/contracts";
import { TradePermissionService } from "./trade-permission.ts";
import { BrokerError, RiskDecisionError } from "./broker/errors.ts";
export type MarketDataSnapshot = {
  status: "MARKET_DATA_ACTIVE" | "ERROR";
  quote: MarketQuote | null;
  candles: HistoricalCandle[];
  error: string | null;
};
export class MarketDataEngine {
  private provider: MarketDataService;
  constructor(provider: MarketDataService) {
    this.provider = provider;
  }
  async snapshot(
    asset: Asset,
    duration = "1 D",
    barSize = "5 mins",
  ): Promise<MarketDataSnapshot> {
    try {
      const [quote, candles] = await Promise.all([
        this.provider.getQuote(asset),
        this.provider.getHistoricalCandles(asset, duration, barSize),
      ]);
      return { status: "MARKET_DATA_ACTIVE", quote, candles, error: null };
    } catch (error) {
      return {
        status: "ERROR",
        quote: null,
        candles: [],
        error:
          error instanceof Error ? error.message : "Market data unavailable.",
      };
    }
  }
}
export class AutomatedTradingPipeline {
  private marketData: MarketDataEngine;
  private strategy: StrategyEngine;
  private risk: RiskManager;
  private permission: TradePermissionService;
  private broker: BrokerService;
  constructor(
    marketData: MarketDataEngine,
    strategy: StrategyEngine,
    risk: RiskManager,
    permission: TradePermissionService,
    broker: BrokerService,
  ) {
    this.marketData = marketData;
    this.strategy = strategy;
    this.risk = risk;
    this.permission = permission;
    this.broker = broker;
  }
  async evaluate(asset: Asset, strategy: TradingStrategy) {
    const snapshot = await this.marketData.snapshot(asset);
    if (!snapshot.quote)
      throw new BrokerError(
        "IBKR_UNAVAILABLE",
        "Market data unavailable; strategy evaluation stopped safely.",
        true,
      );
    const score = await this.strategy.evaluate(strategy, snapshot.quote);
    await this.risk.refresh();
    return { score, snapshot };
  }

  async evaluateAndSubmit(
    asset: Asset,
    strategy: TradingStrategy,
    order: BrokerOrderRequest,
    riskContext: TradeRiskContext,
  ): Promise<{
    score: number;
    snapshot: MarketDataSnapshot;
    order: BrokerOrderResult;
  }> {
    if (order.mode !== "PAPER")
      throw new BrokerError("LIVE_TRADING_LOCKED", "Live trading is locked.");
    if (!order.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Paper order confirmation is required.",
      );
    const { score, snapshot } = await this.evaluate(asset, strategy);
    if (this.risk.evaluateOrder) {
      const riskDecision = await this.risk.evaluateOrder(riskContext);
      if (riskDecision.status !== "APPROVED")
        throw new RiskDecisionError(riskDecision);
    }
    if (!this.permission.canOpenTrade())
      throw new BrokerError(
        "TRADE_PERMISSION_DENIED",
        this.permission.getLockReason() ?? "Trade permission denied.",
      );
    const result = await this.broker.submitPaperOrder(order);
    return { score, snapshot, order: result };
  }
}
