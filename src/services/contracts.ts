import type {
  Asset,
  Backtest,
  JournalEntry,
  MarketQuote,
  Notification,
  Position,
  BrokerAccountSummary,
  BrokerExecution,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerOrderResult,
  HistoricalCandle,
  RiskDecision,
  TradeRiskContext,
  TradeRecommendation,
  TradingStrategy,
} from "@/src/domain/models";
export interface MarketDataService {
  getQuote(asset: Asset): Promise<MarketQuote>;
  getHistoricalCandles(
    asset: Asset,
    duration: string,
    barSize: string,
  ): Promise<HistoricalCandle[]>;
  getQuotes?(assets: Asset[]): Promise<MarketQuote[]>;
  getHealth?(): Promise<{
    status: "CONNECTED" | "DISCONNECTED" | "ERROR";
    provider: string;
    feed: string;
    lastUpdated: string | null;
  }>;
}
export interface BrokerService {
  getAccountSummary(): Promise<BrokerAccountSummary>;
  getPositions(): Promise<Position[]>;
  getOrders(): Promise<BrokerOrder[]>;
  getExecutions(): Promise<BrokerExecution[]>;
  submitPaperOrder(order: BrokerOrderRequest): Promise<BrokerOrderResult>;
  cancelPaperOrder(orderId: string): Promise<BrokerOrderResult>;
}
export interface TradingEngine {
  evaluate(): Promise<void>;
}
export interface StrategyEngine {
  evaluate(strategy: TradingStrategy, quote: MarketQuote): Promise<number>;
}
export interface ResearchEngine {
  research(asset: Asset): Promise<TradeRecommendation>;
}
export interface RiskManager {
  refresh(): Promise<void>;
  evaluateOrder?(context: TradeRiskContext): Promise<RiskDecision>;
}
export interface NotificationService {
  send(notification: Notification): Promise<void>;
}
export interface JournalService {
  record(entry: JournalEntry): Promise<void>;
}
export interface BacktestEngine {
  run(strategy: TradingStrategy): Promise<Backtest>;
}
