export type TradingMode = "PAPER" | "LIVE";
export type Direction = "BUY" | "SELL";
export type RiskState = "NORMAL" | "WARNING" | "LOCKED";
export interface User {
  id: string;
  email: string;
  displayName: string;
}
export interface BrokerAccount {
  id: string;
  userId: string;
  provider: string;
  externalAccountId?: string;
  mode: TradingMode;
  status:
    | "AWAITING_SETUP"
    | "DISCONNECTED"
    | "CONNECTING"
    | "PAPER_CONNECTED"
    | "MARKET_DATA_ACTIVE"
    | "AUTH_REQUIRED"
    | "ERROR";
}
export type BrokerConnectionStatus = BrokerAccount["status"];
export type PaperOrderStatus =
  | "CONFIRMATION_REQUIRED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "FILLED"
  | "CANCELLED"
  | "ERROR";
export interface BrokerAccountSummary {
  accountIdMasked: string;
  balance: number | null;
  netLiquidation: number | null;
  availableCash: number | null;
  buyingPower: number | null;
  currency: string;
  status: BrokerConnectionStatus;
  lastSuccessfulSync: string | null;
  lastError: string | null;
}
export interface BrokerOrderRequest {
  symbol: string;
  direction: Direction;
  quantity: number;
  type: "MARKET" | "LIMIT";
  limitPrice?: number;
  mode: TradingMode;
  confirmed: boolean;
  clientOrderId?: string;
  stopLoss?: number;
  source?: "MANUAL" | "AUTO_TRADER" | "BIG_MONEY";
}
export interface BrokerOrderResult {
  brokerOrderId?: string;
  status: PaperOrderStatus;
  message: string;
  mode: "PAPER";
}
export interface BrokerOrder {
  id: string;
  symbol: string;
  direction: Direction;
  quantity: number;
  type: "MARKET" | "LIMIT";
  status: PaperOrderStatus;
  submittedAt?: string;
}
export interface BrokerExecution {
  id: string;
  orderId: string;
  symbol: string;
  quantity: number;
  price: number;
  executedAt: string;
}
export interface HistoricalCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export type StrategyDirection = "BUY" | "SELL" | "NO_TRADE";
export interface StrategySignal {
  symbol: string;
  direction: StrategyDirection;
  strategyName: string;
  score: number;
  entrySuggestion: number | null;
  stopLossSuggestion: number | null;
  takeProfitSuggestion: number | null;
  riskReward: number | null;
  reasoning: string;
  timestamp: string;
}
export interface CombinedOpportunity {
  symbol: string;
  supportingStrategies: string[];
  conflictingStrategies: string[];
  combinedScore: number;
  finalRecommendation: StrategyDirection;
  signals: StrategySignal[];
  timestamp: string;
  dataSource: string;
  marketDataTimestamp?: string;
  marketAnalysis: {
    bid: number;
    ask: number;
    last: number;
    volatility: number;
    trend: "UP" | "DOWN" | "FLAT";
    momentum: number;
  } | null;
}
export interface AutoTraderConfig {
  enabled: boolean;
  capitalAllocation: number;
  maximumTradeSize: number;
  maximumRiskPerTrade: number;
  dailyLossLimit: number;
  dailyProfitTarget: number;
  maximumTradesPerDay: number;
  maximumConcurrentPositions: number;
  minimumStrategyScore: number;
  allowedStrategies: string[];
  allowedAssets: string[];
}
export type AutomatedDecisionStatus =
  | "EXECUTED"
  | "REJECTED"
  | "SKIPPED"
  | "REDUCED"
  | "LOCKED";
export interface AutomatedDecisionResult {
  opportunityKey: string;
  symbol: string;
  direction: StrategyDirection;
  status: AutomatedDecisionStatus;
  reason: string;
  signalScore: number;
  strategies: string[];
  capital: number;
  maximumPlannedLoss: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  executionSource: "ALPACA_PAPER" | "IBKR_PAPER" | "SIMULATED_PAPER" | "NONE";
  brokerOrderId?: string;
  timestamp: string;
}
export type MarketDataStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "MARKET_DATA_ACTIVE"
  | "AUTH_REQUIRED"
  | "ERROR";
export interface Asset {
  id: string;
  symbol: string;
  name: string;
  assetClass: "EQUITY" | "FOREX" | "COMMODITY";
  currency: string;
}
export interface MarketQuote {
  assetId: string;
  bid: number;
  ask: number;
  last: number;
  asOf: string;
  source: string;
  isDemo: boolean;
  isDelayed: boolean;
  provider: "ALPACA" | "IBKR" | "DEMO";
  feed: string;
}
export interface TradeRecommendation {
  id: string;
  asset: Asset;
  direction: Direction;
  score: number;
  investment: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  marketCondition: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}
export type BigMoneyRecommendationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";
export type BigMoneyRiskProfile = {
  name: "Conservative" | "Recommended" | "Aggressive";
  capital: number;
  stopLoss: number;
  maximumPlannedLoss: number;
  target: number;
  riskReward: number;
};
export interface BigMoneyRecommendation {
  id?: string;
  symbol: string;
  direction: Direction;
  strategyScore: number;
  researchScore: number;
  currentPrice: number;
  recommendedEntry: number;
  recommendedCapital: number;
  recommendedStopLoss: number;
  recommendedTakeProfit: number;
  maximumPlannedLoss: number;
  riskReward: number;
  marketCondition: string;
  supportingStrategies: string[];
  conflictingStrategies: string[];
  reasoning: string;
  dataSource: string;
  quoteTimestamp: string;
  recommendationTimestamp: string;
  expiresAt: string;
  status: BigMoneyRecommendationStatus;
  selectedRiskProfile: BigMoneyRiskProfile["name"];
  riskProfiles: BigMoneyRiskProfile[];
  portfolioExposure: number;
  unavailableResearch: string[];
}
export interface Order {
  id: string;
  userId: string;
  brokerAccountId?: string;
  recommendationId?: string;
  symbol: string;
  direction: Direction;
  type: "MARKET" | "LIMIT" | "STOP";
  quantity: number;
  status: "DRAFT" | "SUBMITTED" | "FILLED" | "CANCELLED" | "REJECTED";
  mode: TradingMode;
}
export interface Position {
  id: string;
  symbol: string;
  direction: Direction;
  entryPrice: number;
  currentPrice: number;
  investment: number;
  profitLoss: number;
  stopLoss: number;
  takeProfit: number;
  mode: TradingMode;
}
export interface Trade {
  id: string;
  positionId?: string;
  orderId: string;
  symbol: string;
  direction: Direction;
  price: number;
  quantity: number;
  executedAt: string;
  mode: TradingMode;
}
export interface TradingStrategy {
  id: string;
  userId: string;
  name: string;
  version: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
}
export interface RiskSettings {
  autoTraderEnabled: boolean;
  autoTraderAllocatedCapital: number;
  maximumCapitalPerTrade: number;
  maximumRiskPerTrade: number;
  dailyMaximumLoss: number;
  dailyProfitTarget: number;
  maximumTradesPerDay: number;
  maximumConcurrentPositions: number;
  maximumPortfolioExposure: number;
  maximumPortfolioDrawdown: number;
  maximumExposurePerAsset: number;
  bigMoneyApprovalThreshold: number;
}
export type RiskDecisionStatus =
  | "APPROVED"
  | "REJECTED"
  | "REDUCE_SIZE"
  | "DAILY_LOCK"
  | "SYSTEM_LOCK";
export interface RiskDecision {
  status: RiskDecisionStatus;
  reason: string;
  approvedCapital: number;
  requestedCapital: number;
  calculatedLoss: number;
}
export interface TradeRiskContext {
  requestedCapital: number;
  expectedPrice: number;
  stopLoss?: number;
  dailyProfitLoss: number;
  tradesToday: number;
  concurrentPositions: number;
  portfolioExposure: number;
  autoTraderExposure: number;
  assetExposure: number;
  portfolioValue: number;
  portfolioDrawdownPct: number;
  source: "MANUAL" | "AUTO_TRADER" | "BIG_MONEY";
  recommendationScore?: number;
  emergencyStopActive: boolean;
  systemLocked: boolean;
  dailyLocked?: boolean;
  dailyLockReason?: string;
}
export interface DailyRiskState {
  date: string;
  profitLoss: number;
  tradesOpened: number;
  riskState: RiskState;
  lockReason?: string;
}
export interface Backtest {
  id: string;
  strategyId: string;
  startedAt: string;
  completedAt?: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  metrics: Record<string, number>;
}
export interface JournalEntry {
  id: string;
  userId: string;
  tradeId?: string;
  title: string;
  body: string;
  createdAt: string;
}
export interface Notification {
  id: string;
  userId: string;
  type: "INFO" | "WARNING" | "ACTION";
  title: string;
  read: boolean;
  createdAt: string;
}
export interface SystemState {
  mode: TradingMode;
  autoTraderStatus: "ACTIVE" | "PAUSED" | "LOCKED";
  riskState: RiskState;
  emergencyStopActive: boolean;
}
export type AuditAction =
  | "AUTO_TRADER_PAUSED"
  | "AUTO_TRADER_RESUMED"
  | "RECOMMENDATION_APPROVED"
  | "RECOMMENDATION_REJECTED"
  | "RISK_SETTING_CHANGED"
  | "EMERGENCY_STOP_ACTIVATED"
  | "EMERGENCY_STOP_RESET"
  | "TRADING_MODE_CHANGED"
  | "BROKER_CONNECTION_ATTEMPTED"
  | "BROKER_CONNECTED"
  | "BROKER_CONNECTION_FAILED"
  | "PAPER_ORDER_SUBMITTED"
  | "PAPER_ORDER_REJECTED"
  | "PAPER_ORDER_FILLED"
  | "PAPER_ORDER_CANCELLED";
export interface AuditEvent {
  id: string;
  userId: string;
  action: AuditAction;
  timestamp: string;
  metadata: Record<string, unknown>;
}
