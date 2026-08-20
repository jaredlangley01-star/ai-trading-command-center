import { createClient } from "@supabase/supabase-js";
import { ProtectiveExitService } from "../src/services/broker/protective-exit-service.ts";
import { fetchAlpacaHistoricalBars } from "../src/services/backtesting/historical-data.ts";
import { runHistoricalBacktest } from "../src/services/backtesting/engine.ts";
import {
  defaultStrategies,
  combineStrategySignals,
} from "../src/services/strategies/combined-opportunity-engine.ts";
import {
  fetchAlpacaNews,
  fetchCorporateActions,
  fetchSecBundle,
  normalizeSecFacts,
  normalizeSecFilings,
} from "../src/services/intelligence/sources.ts";
import { analyzeNews } from "../src/services/intelligence/analysis.ts";
import { buildIntelligenceSnapshot } from "../src/services/intelligence/engine.ts";
import { OpenAIResponsesResearchProvider } from "../src/services/intelligence/ai-provider.ts";
import { AutoTraderEngine } from "../src/services/auto-trader.ts";
import { ProductionRiskManager } from "../src/services/risk-manager.ts";
import { TradePermissionService } from "../src/services/trade-permission.ts";
import { createAlpacaPaperBrokerService } from "../src/services/broker/alpaca-paper-broker-service.ts";
import { CombinedOpportunityEngine } from "../src/services/strategies/combined-opportunity-engine.ts";
import { MarketDataEngine } from "../src/services/market-data-engine.ts";
import { createPaperMarketData } from "../src/services/market-data/factory.ts";
import {
  defaultAutoTraderConfig,
  defaultRiskSettings,
} from "../src/config/trading.ts";
import {
  portfolioGate,
  rankAutonomousCandidates,
  regimeSuitability,
} from "../src/services/autonomous-decision.ts";
import {
  normalizePaperExecutionStatus,
  safePaperExecutionFailure,
} from "../src/services/paper-execution.ts";
import { classifyEquityMarketSession } from "../src/services/market-data/session-freshness.ts";
import {
  canOpenIntradayEntry,
  dayTraderSession,
  evaluateIntradayExit,
  isOvernightViolation,
} from "../src/services/intraday-lifecycle.ts";
import {
  assertPaperTestEnvironment,
  availableTestSlots,
  canAutoApproveBigMoneyTest,
  paperTestStatus,
  rankForTestCoverage,
} from "../src/services/paper-automation-test.ts";

const PAPER_URL = "https://paper-api.alpaca.markets";
const DATA_URL = "https://data.alpaca.markets";
const automatedEntrySource = ["AUTO", "TRADER"].join("_");
const brokerApiKey =
  process.env.ALPACA_PAPER_API_KEY ?? process.env.ALPACA_BROKER_API_KEY;
const brokerApiSecret =
  process.env.ALPACA_PAPER_API_SECRET ?? process.env.ALPACA_BROKER_API_SECRET;
const brokerBaseUrl =
  process.env.ALPACA_PAPER_BASE_URL ??
  process.env.ALPACA_BROKER_BASE_URL ??
  PAPER_URL;
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
];
for (const name of required)
  if (!process.env[name]) throw new Error(`MISSING_ENV:${name}`);
if (!brokerApiKey) throw new Error("MISSING_ENV:ALPACA_PAPER_API_KEY");
if (!brokerApiSecret) throw new Error("MISSING_ENV:ALPACA_PAPER_API_SECRET");
if (process.env.TRADING_RUNTIME_MODE !== "HOSTED_PRODUCTION")
  throw new Error("HOSTED_PRODUCTION_REQUIRED");
if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_ENVIRONMENT ?? "PAPER") !== "PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if (brokerBaseUrl !== PAPER_URL) throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_DATA_FEED ?? "iex").toLowerCase() !== "iex")
  throw new Error("IEX_FEED_REQUIRED");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const workerId = process.env.WORKER_ID ?? "railway-trading-engine";
const intervalMs = Math.max(
  10_000,
  Number(process.env.WORKER_INTERVAL_MS ?? 30_000),
);
const symbols = (process.env.WORKER_SCAN_SYMBOLS ?? "AAPL,MSFT,NVDA,SPY")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const headers = (key, secret) => ({
  "APCA-API-KEY-ID": key,
  "APCA-API-SECRET-KEY": secret,
});
const brokerHeaders = () => headers(brokerApiKey, brokerApiSecret);
let stopping = false;

async function json(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
  return response.status === 204 ? null : response.json();
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const masked = (value) => {
  const text = String(value ?? "");
  return text.length > 4 ? `****${text.slice(-4)}` : "****";
};
async function enqueueNotification(ownerId, event) {
  await db.from("notification_events").upsert(
    {
      user_id: ownerId,
      event_type: event.type,
      category: event.category,
      severity: event.severity,
      title: event.title,
      body: event.body,
      payload: event.payload ?? {},
      deep_link: event.deepLink ?? "/?section=Notifications",
      dedupe_key: event.dedupeKey,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

const mapAutoConfig = (row) => ({
  ...defaultAutoTraderConfig,
  enabled: Boolean(row.enabled),
  capitalAllocation: number(row.capital_allocation),
  maximumTradeSize: number(row.maximum_trade_size),
  maximumRiskPerTrade: number(row.maximum_risk_per_trade),
  dailyLossLimit: number(row.daily_loss_limit),
  dailyProfitTarget: number(row.daily_profit_target),
  maximumTradesPerDay: number(row.maximum_trades_per_day),
  maximumConcurrentPositions: number(row.maximum_concurrent_positions),
  minimumStrategyScore: number(row.minimum_strategy_score),
  allowedStrategies: row.allowed_strategies ?? [],
  allowedAssets: row.allowed_assets ?? [],
  riskProfile: row.risk_profile ?? "BALANCED",
  maximumPortfolioExposure: number(row.maximum_portfolio_exposure ?? 50),
  minimumOpportunityScore: number(row.minimum_opportunity_score ?? 75),
  minimumConfidence: number(row.minimum_confidence ?? 65),
  minimumHistoricalScore: number(row.minimum_historical_score ?? 0),
  longEnabled: row.long_enabled !== false,
  shortEnabled: Boolean(row.short_enabled),
  sessionStart: String(row.session_start ?? "09:30"),
  sessionEnd: String(row.session_end ?? "16:00"),
  sessionTimezone: String(row.session_timezone ?? "America/New_York"),
  entryStart: String(row.entry_start ?? "09:35"),
  lastEntryTime: String(row.last_entry_time ?? "15:15"),
  forceExitTime: String(row.force_exit_time ?? "15:50"),
  maximumHoldMinutes:
    row.maximum_hold_minutes == null ? null : number(row.maximum_hold_minutes),
  minimumExitScore: number(row.minimum_exit_score ?? 45),
  strategyHealthMinimumSample: number(row.strategy_health_minimum_sample ?? 20),
  cooldownMinutes: number(row.cooldown_minutes ?? 60),
  lossCooldownMinutes: number(row.loss_cooldown_minutes ?? 240),
  paperTestMode: row.paper_test_mode === true,
  paperTestTargetAutoPositions: number(
    row.paper_test_target_auto_positions ?? 8,
  ),
  paperBigMoneyTestMode: Boolean(row.paper_big_money_test_mode),
  paperTestTargetBigMoneyPositions: number(
    row.paper_test_target_big_money_positions ?? 2,
  ),
  paperBigMoneyAutoApproveTest: Boolean(row.paper_big_money_auto_approve_test),
  paperTestMinimumOpportunityScore: number(
    row.paper_test_min_opportunity_score ?? 60,
  ),
  paperTestMinimumConfidence: number(row.paper_test_min_confidence ?? 50),
  paperTestMaximumPositionSize: number(
    row.paper_test_max_position_size ?? 1000,
  ),
  paperTestMaximumRiskPerTrade: number(
    row.paper_test_max_risk_per_trade ?? 100,
  ),
  paperTestMaximumDailyTrades: number(row.paper_test_max_daily_trades ?? 30),
  paperTestUniverse:
    row.paper_test_universe ?? defaultAutoTraderConfig.paperTestUniverse,
});

async function processAutonomousOwner(ownerId, account, brokerPositions) {
  const today = new Date().toISOString().slice(0, 10);
  const [configResult, systemResult, riskResult, dailyResult, snapshotsResult] =
    await Promise.all([
      db
        .from("auto_trader_config")
        .select("*")
        .eq("user_id", ownerId)
        .maybeSingle(),
      db.from("system_state").select("*").eq("user_id", ownerId).maybeSingle(),
      db
        .from("risk_settings")
        .select("settings")
        .eq("user_id", ownerId)
        .maybeSingle(),
      db
        .from("daily_risk_state")
        .select("*")
        .eq("user_id", ownerId)
        .eq("trading_date", today)
        .maybeSingle(),
      db
        .from("intelligence_snapshots")
        .select("*")
        .eq("user_id", ownerId)
        .order("generated_at", { ascending: false })
        .limit(100),
    ]);
  if (!configResult.data) return;
  let config = mapAutoConfig(configResult.data),
    system = systemResult.data;
  if (system?.auto_trader_status !== "ACTIVE" || system?.emergency_stop_active)
    return;
  if (config.paperTestMode) {
    assertPaperTestEnvironment({
      mode: system?.mode,
      brokerAdapter: process.env.BROKER_ADAPTER,
      liveTradingEnabled: process.env.LIVE_TRADING_ENABLED,
    });
    config = {
      ...config,
      allowedAssets: config.paperTestUniverse,
      minimumOpportunityScore: config.paperTestMinimumOpportunityScore,
      minimumConfidence: config.paperTestMinimumConfidence,
      maximumTradeSize: Math.min(
        config.maximumTradeSize,
        config.paperTestMaximumPositionSize,
      ),
      maximumRiskPerTrade: Math.min(
        config.maximumRiskPerTrade,
        config.paperTestMaximumRiskPerTrade,
      ),
      maximumTradesPerDay: Math.min(
        config.maximumTradesPerDay,
        config.paperTestMaximumDailyTrades,
      ),
    };
  }
  const [
    { data: confirmedAuto },
    { data: pendingAuto },
    { data: completedCoverage },
  ] = await Promise.all([
    db
      .from("paper_positions")
      .select("symbol,broker_position_id,protection_status")
      .eq("user_id", ownerId)
      .eq("trade_origin", "AUTO_TRADER")
      .in("status", ["OPEN", "EXIT_PENDING"]),
    db
      .from("paper_execution_requests")
      .select("symbol")
      .eq("user_id", ownerId)
      .eq("source", "AUTO_TRADER")
      .in("status", [
        "QUEUED",
        "SUBMITTING",
        "SUBMITTED",
        "ACCEPTED",
        "PARTIALLY_FILLED",
      ]),
    db
      .from("completed_paper_trades")
      .select("strategy_name")
      .eq("user_id", ownerId)
      .eq("trade_origin", "AUTO_TRADER")
      .eq("paper_test_mode", true),
  ]);
  const target = Math.min(
    config.paperTestTargetAutoPositions,
    config.maximumConcurrentPositions,
  );
  const slots = config.paperTestMode
    ? availableTestSlots(
        target,
        (confirmedAuto ?? []).filter((item) => item.broker_position_id).length,
        pendingAuto?.length ?? 0,
      )
    : 1;
  const latest = new Map();
  for (const snapshot of snapshotsResult.data ?? [])
    if (
      !latest.has(snapshot.symbol) &&
      config.allowedAssets.includes(snapshot.symbol)
    )
      latest.set(snapshot.symbol, snapshot);
  const candidates = [...latest.values()].map((snapshot) => {
    const strategy = String(
      snapshot.deterministic_analysis?.parts?.technical?.explanation?.[0] ??
        "Combined Production Strategies",
    ).split(":")[0];
    const requestedRegime = String(
      snapshot.deterministic_analysis?.marketContext?.regime ?? "SIDEWAYS",
    ).toUpperCase();
    const marketRegime = [
      "BULLISH",
      "BEARISH",
      "SIDEWAYS",
      "HIGH_VOLATILITY",
      "REDUCED_LIQUIDITY",
    ].includes(requestedRegime)
      ? requestedRegime
      : "SIDEWAYS";
    return {
      symbol: snapshot.symbol,
      direction: snapshot.direction,
      strategy,
      strategyScore: number(snapshot.technical_score),
      opportunityScore: number(snapshot.opportunity_score),
      confidence: number(snapshot.confidence),
      historicalScore: number(snapshot.historical_score),
      riskReward: 2,
      marketRegime,
      regimeSuitability: regimeSuitability(
        strategy,
        snapshot.direction,
        marketRegime,
      ),
      quoteTimestamp: snapshot.generated_at,
      reasons:
        snapshot.deterministic_analysis?.parts?.technical?.explanation ?? [],
    };
  });
  let ranked = rankAutonomousCandidates(candidates, config);
  if (config.paperTestMode) {
    const coverage = {};
    for (const trade of completedCoverage ?? [])
      coverage[trade.strategy_name] = (coverage[trade.strategy_name] ?? 0) + 1;
    ranked = rankForTestCoverage(ranked, coverage, [
      ...brokerPositions.map((position) => String(position.symbol)),
      ...(pendingAuto ?? []).map((request) => String(request.symbol)),
    ]);
  }
  if (
    config.paperTestMode &&
    (confirmedAuto ?? []).some(
      (item) => item.protection_status === "UNPROTECTED",
    )
  )
    return;
  if (slots === 0) return;
  const sessionOpen = canOpenIntradayEntry(new Date(), {
    timezone: config.sessionTimezone,
    sessionStart: config.sessionStart,
    sessionEnd: config.sessionEnd,
    entryStart: config.entryStart,
    lastEntryTime: config.lastEntryTime,
    forceExitTime: config.forceExitTime,
    maxHoldMinutes: config.maximumHoldMinutes,
    minimumExitScore: config.minimumExitScore,
  });
  if (config.paperTestMode) {
    const status = paperTestStatus({
      enabled: true,
      sessionOpen,
      autoConfirmed: (confirmedAuto ?? []).filter(
        (item) => item.broker_position_id,
      ).length,
      autoTarget: target,
    });
    await db.from("paper_automation_test_cycles").upsert(
      {
        user_id: ownerId,
        cycle_key: `stress:${ownerId}:${new Date().toISOString().slice(0, 16)}`,
        status,
        target_auto_positions: target,
        confirmed_auto_positions: (confirmedAuto ?? []).filter(
          (item) => item.broker_position_id,
        ).length,
        pending_auto_orders: pendingAuto?.length ?? 0,
        target_big_money_positions: config.paperTestTargetBigMoneyPositions,
        confirmed_big_money_positions:
          brokerPositions.filter((position) => String(position.symbol)).length -
          (confirmedAuto?.length ?? 0),
        metrics: {
          availableSlots: slots,
          candidates: ranked.length,
          safety: "LIVE_LOCKED",
        },
        strategy_coverage: Object.fromEntries(
          (completedCoverage ?? []).map((trade) => [trade.strategy_name, true]),
        ),
        symbol_coverage: Object.fromEntries(
          (confirmedAuto ?? []).map((position) => [position.symbol, true]),
        ),
      },
      { onConflict: "user_id,cycle_key" },
    );
    if (status === "TARGET_REACHED")
      await enqueueNotification(ownerId, {
        type: "PAPER_TEST_TARGET_REACHED",
        category: "TRADE",
        severity: "INFO",
        title: "PAPER Automation Test Target Reached",
        body: `All ${target} confirmed Auto Trader PAPER slots are filled.`,
        payload: { target, confirmedOnly: true },
        deepLink: "/?section=Auto%20Trader",
        dedupeKey: `paper-test-target:${new Date().toISOString().slice(0, 10)}:${target}`,
      });
  }
  const { data: lastDecision } = await db
    .from("automated_decisions")
    .select("created_at,status")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cooldown =
    !config.paperTestMode &&
    lastDecision &&
    Date.now() - Date.parse(lastDecision.created_at) <
      (lastDecision.status === "REJECTED"
        ? config.lossCooldownMinutes
        : config.cooldownMinutes) *
        60_000;
  for (const candidate of ranked) {
    if (!sessionOpen)
      candidate.rejectionReasons.push("OUTSIDE_INTRADAY_ENTRY_WINDOW");
    if (cooldown) candidate.rejectionReasons.push("TRADE_COOLDOWN_ACTIVE");
    if (!sessionOpen || cooldown) candidate.decision = "REJECTED";
  }
  const portfolio = brokerPositions.map((position) => ({
    symbol: String(position.symbol).toUpperCase(),
    direction: String(position.side) === "short" ? "SELL" : "BUY",
    strategy: "UNKNOWN",
    exposure: Math.abs(number(position.market_value)),
  }));
  const cycleKey = `hosted:${ownerId}:${new Date().toISOString().slice(0, 13)}`;
  for (const candidate of ranked) {
    const gate = portfolioGate({
      symbol: candidate.symbol,
      direction: candidate.direction === "SELL" ? "SELL" : "BUY",
      strategy: candidate.strategy,
      positions: portfolio,
      equity: number(account.equity),
      maximumPortfolioExposurePct: config.maximumPortfolioExposure,
      maximumSymbolExposurePct: number(
        riskResult.data?.settings?.maximumExposurePerAsset ?? 20,
      ),
      maximumConcurrentPositions: config.maximumConcurrentPositions,
    });
    candidate.rejectionReasons.push(...gate.reasons);
    if (gate.reasons.length) candidate.decision = "REJECTED";
    await db.from("autonomous_candidate_evaluations").upsert(
      {
        user_id: ownerId,
        cycle_key: cycleKey,
        symbol: candidate.symbol,
        strategy: candidate.strategy,
        signal: candidate.direction,
        scores: {
          rank: candidate.rankScore,
          opportunity: candidate.opportunityScore,
          confidence: candidate.confidence,
          technical: candidate.strategyScore,
          historical: candidate.historicalScore,
          regimeSuitability: candidate.regimeSuitability,
        },
        market_regime: candidate.marketRegime ?? "SIDEWAYS",
        portfolio_context: gate,
        decision: candidate.decision,
        reasons: candidate.rejectionReasons,
        selected: false,
      },
      { onConflict: "user_id,cycle_key,symbol,strategy" },
    );
  }
  const winner = ranked.find((candidate) => candidate.decision === "ELIGIBLE");
  if (!winner) return;
  const { data: selectedEvaluation } = await db
    .from("autonomous_candidate_evaluations")
    .update({ selected: true })
    .eq("user_id", ownerId)
    .eq("cycle_key", cycleKey)
    .eq("symbol", winner.symbol)
    .select("id")
    .single();
  if (!createAlpacaPaperBrokerService()) return;
  const state = {
    mode: "PAPER",
    autoTraderStatus: "ACTIVE",
    riskState: system?.risk_state ?? "NORMAL",
    emergencyStopActive: Boolean(system?.emergency_stop_active),
  };
  const settings = {
    ...defaultRiskSettings,
    ...(riskResult.data?.settings ?? {}),
  };
  let activeExecutionKey = null;
  const risk = new ProductionRiskManager(
    settings,
    async (context, decision) => {
      await db.from("risk_decisions").insert({
        user_id: ownerId,
        client_order_id: activeExecutionKey,
        symbol: winner.symbol,
        source: automatedEntrySource,
        decision: decision.status,
        reason: decision.reason,
        requested_capital: decision.requestedCapital,
        approved_capital: decision.approvedCapital,
        calculated_loss: decision.calculatedLoss,
        context,
      });
    },
  );
  const autoQueueBroker = {
    submitPaperOrder: async (order) => {
      const { data: existing } = await db
        .from("paper_execution_requests")
        .select("id,status")
        .eq("user_id", ownerId)
        .eq("client_order_id", order.clientOrderId)
        .maybeSingle();
      if (existing)
        return {
          brokerOrderId: existing.id,
          status: existing.status,
          message: "Existing durable Auto Trader PAPER request returned.",
          mode: "PAPER",
        };
      const { data: platformOrder, error: orderError } = await db
        .from("orders")
        .insert({
          user_id: ownerId,
          symbol: order.symbol,
          direction: order.direction,
          order_type: order.type,
          quantity: order.quantity,
          limit_price: order.limitPrice,
          status: "DRAFT",
          mode: "PAPER",
          source: "AUTO_TRADER",
          classification: "SMALL",
          client_order_id: order.clientOrderId,
        })
        .select("id")
        .single();
      if (orderError || !platformOrder) throw new Error("QUEUE_ORDER_FAILED");
      const { data: request, error: requestError } = await db
        .from("paper_execution_requests")
        .insert({
          user_id: ownerId,
          order_id: platformOrder.id,
          client_order_id: order.clientOrderId,
          symbol: order.symbol,
          direction: order.direction,
          quantity: order.quantity,
          order_type: order.type,
          limit_price: order.limitPrice,
          stop_loss: order.stopLoss,
          take_profit: order.takeProfit,
          source: "AUTO_TRADER",
          status: "QUEUED",
          paper_test_mode: config.paperTestMode,
          test_slot: config.paperTestMode
            ? (confirmedAuto?.length ?? 0) + (pendingAuto?.length ?? 0) + 1
            : null,
          candidate_rank: config.paperTestMode
            ? ranked.indexOf(winner) + 1
            : null,
          selection_reason: config.paperTestMode
            ? `Genuine eligible candidate; strategy coverage preference for ${winner.strategy}.`
            : null,
          test_thresholds: config.paperTestMode
            ? {
                opportunity: config.minimumOpportunityScore,
                confidence: config.minimumConfidence,
                maximumPositionSize: config.maximumTradeSize,
                maximumRiskPerTrade: config.maximumRiskPerTrade,
              }
            : {},
        })
        .select("id,status")
        .single();
      if (requestError || !request) throw new Error("QUEUE_REQUEST_FAILED");
      await db
        .from("orders")
        .update({ status: "QUEUED", updated_at: new Date().toISOString() })
        .eq("id", platformOrder.id);
      return {
        brokerOrderId: request.id,
        status: "QUEUED",
        message: "Auto Trader PAPER order queued for Railway execution.",
        mode: "PAPER",
      };
    },
  };
  const engine = new AutoTraderEngine(
    new CombinedOpportunityEngine(
      new MarketDataEngine(createPaperMarketData()),
    ),
    risk,
    new TradePermissionService(state, settings),
    autoQueueBroker,
    "ALPACA_PAPER",
    config,
    {
      claimOpportunity: async (key) => {
        activeExecutionKey = key;
        const { error } = await db.from("autonomous_execution_claims").insert({
          user_id: ownerId,
          execution_key: key,
          candidate_id: selectedEvaluation?.id,
          state: "CLAIMED",
        });
        return !error;
      },
      buildRiskContext: async (order) => {
        const exposure = portfolio.reduce(
            (sum, item) => sum + item.exposure,
            0,
          ),
          assetExposure = portfolio
            .filter((item) => item.symbol === winner.symbol)
            .reduce((sum, item) => sum + item.exposure, 0),
          equity = number(account.equity);
        return {
          requestedCapital: number(order.limitPrice) * order.quantity,
          expectedPrice: number(order.limitPrice),
          stopLoss: order.stopLoss,
          dailyProfitLoss: number(dailyResult.data?.profit_loss),
          tradesToday: number(dailyResult.data?.trades_opened),
          concurrentPositions: portfolio.length,
          portfolioExposure: exposure,
          autoTraderExposure: exposure,
          assetExposure,
          portfolioValue: equity,
          portfolioDrawdownPct: 0,
          source: automatedEntrySource,
          emergencyStopActive: state.emergencyStopActive,
          systemLocked: state.riskState === "LOCKED",
          dailyLocked: dailyResult.data?.status === "DAILY_LOCK",
          dailyLockReason: dailyResult.data?.lock_reason ?? undefined,
        };
      },
      record: async (result) => {
        await db.from("automated_decisions").upsert(
          {
            user_id: ownerId,
            opportunity_key: result.opportunityKey,
            symbol: result.symbol,
            direction: result.direction,
            status: result.status,
            reason: result.reason,
            signal_score: result.signalScore,
            strategies: result.strategies,
            capital: result.capital,
            maximum_planned_loss: result.maximumPlannedLoss,
            entry_price: result.entry,
            stop_loss: result.stopLoss,
            take_profit: result.takeProfit,
            execution_source: result.executionSource,
            broker_order_id: result.brokerOrderId,
            completed_at: result.timestamp,
          },
          { onConflict: "user_id,opportunity_key" },
        );
        await db
          .from("autonomous_execution_claims")
          .update({
            state: result.brokerOrderId ? "SUBMITTED" : "REJECTED",
            broker_order_id: result.brokerOrderId,
            broker_result: result,
            updated_at: result.timestamp,
          })
          .eq("user_id", ownerId)
          .eq("execution_key", result.opportunityKey);
        await enqueueNotification(ownerId, {
          type: result.brokerOrderId ? "ORDER_QUEUED" : "RISK_MANAGER_WARNING",
          category: result.brokerOrderId ? "TRADE" : "RISK",
          severity: result.brokerOrderId ? "INFO" : "WARNING",
          title: result.brokerOrderId
            ? `${result.symbol} Autonomous PAPER Order Queued`
            : `${result.symbol} Autonomous Entry Blocked`,
          body: `${result.status}: ${result.reason}.`,
          payload: {
            symbol: result.symbol,
            strategy: result.strategies[0],
            capital: result.capital,
            maximumPlannedLoss: result.maximumPlannedLoss,
          },
          deepLink: "/?section=Auto%20Trader",
          dedupeKey: `auto:${result.opportunityKey}:${result.status}`,
        });
      },
    },
  );
  await engine.run({
    id: winner.symbol.toLowerCase(),
    symbol: winner.symbol,
    name: winner.symbol,
    assetClass: "EQUITY",
    currency: "USD",
  });
}

async function processBigMoneyTestOwner(ownerId, account, brokerPositions) {
  const [
    { data: row },
    { data: system },
    { data: riskRow },
    { data: recommendations },
    { data: confirmed },
  ] = await Promise.all([
    db
      .from("auto_trader_config")
      .select("*")
      .eq("user_id", ownerId)
      .maybeSingle(),
    db.from("system_state").select("*").eq("user_id", ownerId).maybeSingle(),
    db
      .from("risk_settings")
      .select("settings")
      .eq("user_id", ownerId)
      .maybeSingle(),
    db
      .from("recommendations")
      .select("*")
      .eq("user_id", ownerId)
      .eq("status", "PENDING")
      .order("research_score", { ascending: false })
      .limit(20),
    db
      .from("paper_positions")
      .select("symbol,broker_position_id")
      .eq("user_id", ownerId)
      .eq("trade_origin", "BIG_MONEY")
      .in("status", ["OPEN", "EXIT_PENDING"]),
  ]);
  if (!row) return;
  const config = mapAutoConfig(row);
  const settings = { ...defaultRiskSettings, ...(riskRow?.settings ?? {}) };
  for (const rec of recommendations ?? []) {
    const eligibility = canAutoApproveBigMoneyTest({
      settings: {
        enabled: config.paperTestMode,
        targetAutoPositions: config.paperTestTargetAutoPositions,
        bigMoneyEnabled: config.paperBigMoneyTestMode,
        targetBigMoneyPositions: config.paperTestTargetBigMoneyPositions,
        bigMoneyAutoApprove: config.paperBigMoneyAutoApproveTest,
        minimumOpportunityScore: config.paperTestMinimumOpportunityScore,
        minimumConfidence: config.paperTestMinimumConfidence,
        maximumPositionSize: config.paperTestMaximumPositionSize,
        maximumRiskPerTrade: config.paperTestMaximumRiskPerTrade,
        maximumDailyTrades: config.paperTestMaximumDailyTrades,
        universe: config.paperTestUniverse,
      },
      mode: system?.mode,
      liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
      confirmedPositions: (confirmed ?? []).filter(
        (item) => item.broker_position_id,
      ).length,
      recommendationStatus: rec.status,
      researchScore: number(rec.research_score),
      requiredScore: number(settings.bigMoneyApprovalThreshold),
      researchAvailable: Boolean(rec.research_summary && rec.quote_timestamp),
    });
    if (!eligibility.allowed) continue;
    assertPaperTestEnvironment({
      mode: system?.mode,
      brokerAdapter: process.env.BROKER_ADAPTER,
      liveTradingEnabled: process.env.LIVE_TRADING_ENABLED,
    });
    if (Date.now() - Date.parse(String(rec.quote_timestamp)) > 5 * 60_000)
      continue;
    if (
      brokerPositions.some(
        (position) =>
          String(position.symbol).toUpperCase() ===
          String(rec.symbol).toUpperCase(),
      )
    )
      continue;
    const price = number(rec.current_price),
      capital = Math.min(
        number(rec.investment),
        config.paperTestMaximumPositionSize,
      );
    if (
      !(
        price > 0 &&
        capital > 0 &&
        number(rec.stop_loss) > 0 &&
        number(rec.take_profit) > 0
      )
    )
      continue;
    const state = {
      mode: "PAPER",
      autoTraderStatus: system?.auto_trader_status ?? "PAUSED",
      riskState: system?.risk_state ?? "NORMAL",
      emergencyStopActive: Boolean(system?.emergency_stop_active),
    };
    const context = {
      requestedCapital: capital,
      expectedPrice: price,
      stopLoss: number(rec.stop_loss),
      dailyProfitLoss: 0,
      tradesToday: 0,
      concurrentPositions: brokerPositions.length,
      portfolioExposure: brokerPositions.reduce(
        (sum, item) => sum + Math.abs(number(item.market_value)),
        0,
      ),
      autoTraderExposure: 0,
      assetExposure: 0,
      portfolioValue: number(account.equity),
      portfolioDrawdownPct: 0,
      source: "BIG_MONEY",
      recommendationScore: number(rec.research_score),
      emergencyStopActive: state.emergencyStopActive,
      systemLocked: state.riskState === "LOCKED",
    };
    const decision = await new ProductionRiskManager(settings).evaluateOrder(
      context,
    );
    const permission = new TradePermissionService(state, settings);
    if (decision.status !== "APPROVED" || !permission.canOpenTrade()) continue;
    const clientOrderId = `big-money-test:${rec.id}:${rec.version}`;
    const { data: existing } = await db
      .from("paper_execution_requests")
      .select("id")
      .eq("user_id", ownerId)
      .eq("client_order_id", clientOrderId)
      .maybeSingle();
    if (existing) continue;
    const { data: order, error: orderError } = await db
      .from("orders")
      .insert({
        user_id: ownerId,
        recommendation_id: rec.id,
        symbol: rec.symbol,
        direction: rec.direction,
        order_type: "LIMIT",
        quantity: Math.max(1, Math.floor(capital / price)),
        limit_price: price,
        status: "DRAFT",
        mode: "PAPER",
        source: "BIG_MONEY",
        classification: "BIG",
        client_order_id: clientOrderId,
      })
      .select("id")
      .single();
    if (orderError || !order) continue;
    const { data: queued, error: queueError } = await db
      .from("paper_execution_requests")
      .insert({
        user_id: ownerId,
        order_id: order.id,
        client_order_id: clientOrderId,
        symbol: rec.symbol,
        direction: rec.direction,
        quantity: Math.max(1, Math.floor(capital / price)),
        order_type: "LIMIT",
        limit_price: price,
        stop_loss: rec.stop_loss,
        take_profit: rec.take_profit,
        source: "BIG_MONEY",
        status: "QUEUED",
        paper_test_mode: true,
        selection_reason:
          "TEST AUTO-APPROVAL: qualifying deterministic Big Money PAPER recommendation.",
        test_thresholds: {
          researchScore: settings.bigMoneyApprovalThreshold,
          maximumPositionSize: config.paperTestMaximumPositionSize,
        },
      })
      .select("id")
      .single();
    if (queueError || !queued) continue;
    const now = new Date().toISOString();
    await Promise.all([
      db
        .from("orders")
        .update({ status: "QUEUED", updated_at: now })
        .eq("id", order.id),
      db
        .from("recommendations")
        .update({
          status: "APPROVED",
          approval_timestamp: now,
          updated_at: now,
        })
        .eq("id", rec.id)
        .eq("status", "PENDING"),
      db.from("audit_events").insert({
        user_id: ownerId,
        action: "BIG_MONEY_TEST_AUTO_APPROVAL",
        metadata: {
          recommendationId: rec.id,
          executionRequestId: queued.id,
          environment: "PAPER",
          riskDecision: decision.reason,
        },
      }),
    ]);
    break;
  }
}

async function submitProtectivePaperExit(ownerId, position, reason) {
  if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
    throw new Error("LIVE_TRADING_LOCKED");
  if ((process.env.ALPACA_BROKER_BASE_URL ?? PAPER_URL) !== PAPER_URL)
    throw new Error("LIVE_TRADING_LOCKED");
  const quantity = Math.abs(number(position.qty));
  if (!quantity) return;
  const clientOrderId = `protective:${ownerId}:${position.asset_id}`;
  const claim = {
    user_id: ownerId,
    broker_position_id: String(position.asset_id),
    reason,
    client_order_id: clientOrderId,
    status: "CLAIMED",
    trigger_price: number(position.current_price),
  };
  const { data: existingClaim } = await db
    .from("paper_position_exit_claims")
    .select("id,status")
    .eq("user_id", ownerId)
    .eq("broker_position_id", String(position.asset_id))
    .maybeSingle();
  if (existingClaim && existingClaim.status !== "FAILED") return;
  if (existingClaim?.status === "FAILED") {
    const reconciled = await json(
      `${PAPER_URL}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
      { headers: brokerHeaders() },
    ).catch(() => null);
    if (reconciled?.id) {
      await db
        .from("paper_position_exit_claims")
        .update({
          status: "SUBMITTED",
          broker_order_id: String(reconciled.id),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingClaim.id);
      return;
    }
  }
  const claimResult = existingClaim
    ? await db
        .from("paper_position_exit_claims")
        .update({
          reason,
          status: "CLAIMED",
          trigger_price: number(position.current_price),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingClaim.id)
        .eq("status", "FAILED")
    : await db.from("paper_position_exit_claims").insert(claim);
  if (claimResult.error) return; // Unique claim means another cycle/restart owns the exit.
  try {
    const brokerAdapter = {
      submitPaperOrder: async (order) => {
        const response = await json(`${PAPER_URL}/v2/orders`, {
          method: "POST",
          headers: { ...brokerHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            symbol: order.symbol,
            qty: String(order.quantity),
            side: order.direction.toLowerCase(),
            type: "market",
            time_in_force: "day",
            client_order_id: order.clientOrderId,
          }),
        });
        return {
          brokerOrderId: String(response.id),
          status: "ACCEPTED",
          message: "Alpaca PAPER protective exit accepted.",
          mode: "PAPER",
        };
      },
    };
    const exitService = new ProtectiveExitService(brokerAdapter, {
      mode: "PAPER",
      autoTraderStatus: "PAUSED",
      riskState: "LOCKED",
      emergencyStopActive: true,
    });
    const result = await exitService.submit({
      symbol: String(position.symbol).toUpperCase(),
      direction: String(position.side) === "short" ? "BUY" : "SELL",
      quantity,
      openQuantity: quantity,
      reason,
      clientOrderId,
    });
    await db
      .from("paper_position_exit_claims")
      .update({
        status: "SUBMITTED",
        broker_order_id: result.brokerOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq("client_order_id", clientOrderId);
    await db
      .from("paper_positions")
      .update({ status: "EXIT_PENDING", exit_reason: reason })
      .eq("user_id", ownerId)
      .eq("broker_position_id", String(position.asset_id));
    await db.from("audit_events").insert({
      user_id: ownerId,
      action: "PAPER_POSITION_EXIT_SUBMITTED",
      metadata: {
        mode: "PAPER",
        broker: "ALPACA_PAPER",
        reason,
        symbol: position.symbol,
        client_order_id: clientOrderId,
      },
    });
    await enqueueNotification(ownerId, {
      type:
        reason === "STOP_LOSS"
          ? "STOP_LOSS_HIT"
          : reason === "TAKE_PROFIT"
            ? "TAKE_PROFIT_HIT"
            : "ORDER_SUBMITTED",
      category: "TRADE",
      severity: ["STOP_LOSS", "RISK_EXIT", "EMERGENCY_EXIT"].includes(reason)
        ? "WARNING"
        : "INFO",
      title: `${String(position.symbol).toUpperCase()} ${reason.replaceAll("_", " ")} Exit Submitted`,
      body: `A protective PAPER exit was submitted for ${quantity} ${String(position.symbol).toUpperCase()}.`,
      payload: {
        symbol: String(position.symbol).toUpperCase(),
        quantity,
        reason,
      },
      deepLink: "/?section=Portfolio",
      dedupeKey: `protective:submitted:${clientOrderId}`,
    });
  } catch (error) {
    await db
      .from("paper_position_exit_claims")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "EXIT_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("client_order_id", clientOrderId);
    await enqueueNotification(ownerId, {
      type: "PROTECTIVE_EXIT_FAILURE",
      category: "RISK",
      severity: "CRITICAL",
      title: "Protective PAPER Exit Failed",
      body: `${String(position.symbol).toUpperCase()} protective exit failed. Position monitoring remains active; owner attention is required.`,
      payload: {
        symbol: String(position.symbol).toUpperCase(),
        reason,
        code: error instanceof Error ? error.message : "EXIT_FAILED",
      },
      deepLink: "/?section=Portfolio",
      dedupeKey: `protective:failed:${clientOrderId}`,
    });
  }
}

async function synchronizeOwnerPortfolio(
  ownerId,
  account,
  positions,
  orders,
  fills,
  portfolioHistory,
  asOf,
) {
  const [
    { data: controls },
    { data: legacyPositions },
    { data: platformOrders },
    { data: automatedDecisions },
    { data: executionRequests },
    { data: autoConfigRow },
    { data: ownerSystem },
    { data: latestSignals },
  ] = await Promise.all([
    db
      .from("paper_positions")
      .select(
        "broker_position_id,broker_order_id,entry_order_id,symbol,stop_loss,take_profit,planned_stop,planned_target,protection_status,protection_type,strategy_name,trade_origin,risk_decision_id,side,quantity,entry_price,opened_at,exit_reason,status,paper_test_mode,test_slot",
      )
      .eq("user_id", ownerId),
    db
      .from("positions")
      .select("symbol,stop_loss,take_profit,source,opened_at")
      .eq("user_id", ownerId),
    db
      .from("orders")
      .select(
        "id,symbol,source,status,client_order_id,broker_order_id,automated_decision_id,recommendation_id,created_at",
      )
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("automated_decisions")
      .select("id,strategies,risk_decision_id")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("paper_execution_requests")
      .select(
        "id,order_id,client_order_id,status,stop_loss,take_profit,paper_test_mode,test_slot",
      )
      .eq("user_id", ownerId)
      .limit(250),
    db
      .from("auto_trader_config")
      .select("*")
      .eq("user_id", ownerId)
      .maybeSingle(),
    db
      .from("system_state")
      .select("emergency_stop_active,risk_state")
      .eq("user_id", ownerId)
      .maybeSingle(),
    db
      .from("strategy_signals")
      .select("symbol,strategy_name,direction,score,reasoning,evaluated_at")
      .eq("user_id", ownerId)
      .order("evaluated_at", { ascending: false })
      .limit(250),
  ]);
  const autoConfig = autoConfigRow ? mapAutoConfig(autoConfigRow) : null;
  const autoSchedule = autoConfig
    ? {
        timezone: autoConfig.sessionTimezone,
        sessionStart: autoConfig.sessionStart,
        sessionEnd: autoConfig.sessionEnd,
        entryStart: autoConfig.entryStart,
        lastEntryTime: autoConfig.lastEntryTime,
        forceExitTime: autoConfig.forceExitTime,
        maxHoldMinutes: autoConfig.maximumHoldMinutes,
        minimumExitScore: autoConfig.minimumExitScore,
      }
    : null;
  const autoSession = autoSchedule
    ? dayTraderSession(new Date(asOf), autoSchedule)
    : "CLOSED";
  const signalMap = new Map();
  for (const signal of latestSignals ?? [])
    if (
      !signalMap.has(
        `${String(signal.symbol).toUpperCase()}:${String(signal.strategy_name)}`,
      )
    )
      signalMap.set(
        `${String(signal.symbol).toUpperCase()}:${String(signal.strategy_name)}`,
        signal,
      );
  const legacyMap = new Map(
    (legacyPositions ?? []).map((row) => [
      String(row.symbol).toUpperCase(),
      row,
    ]),
  );
  const controlMap = new Map(
    (controls ?? []).map((row) => [row.broker_position_id, row]),
  );
  const platformOrderByClientId = new Map(
    (platformOrders ?? []).map((order) => [order.client_order_id, order]),
  );
  const automatedDecisionMap = new Map(
    (automatedDecisions ?? []).map((decision) => [decision.id, decision]),
  );
  const executionRequestMap = new Map(
    (executionRequests ?? []).map((request) => [
      request.client_order_id,
      request,
    ]),
  );
  const executionRequestByOrder = new Map(
    (executionRequests ?? []).map((request) => [request.order_id, request]),
  );
  const orderMap = new Map();
  for (const brokerOrder of orders ?? []) {
    const platformOrder = platformOrderByClientId.get(
      String(brokerOrder.client_order_id ?? ""),
    );
    const symbol = String(brokerOrder.symbol).toUpperCase();
    if (platformOrder && !orderMap.has(symbol))
      orderMap.set(symbol, platformOrder);
    if (platformOrder) {
      const status = normalizePaperExecutionStatus(brokerOrder.status);
      if (
        autoSession === "CLOSING" &&
        platformOrder.source === "AUTO_TRADER" &&
        ["NEW", "ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED"].includes(status)
      )
        await json(
          `${PAPER_URL}/v2/orders/${encodeURIComponent(String(brokerOrder.id))}`,
          {
            method: "DELETE",
            headers: brokerHeaders(),
          },
        ).catch(() => null);
      const updatedAt = new Date().toISOString();
      const priorRequest = executionRequestMap.get(
        String(brokerOrder.client_order_id ?? ""),
      );
      const filledQuantity = number(brokerOrder.filled_qty);
      const averageFillPrice = number(brokerOrder.filled_avg_price) || null;
      const acknowledgedAt =
        brokerOrder.accepted_at ?? brokerOrder.submitted_at ?? updatedAt;
      const filledAt = status === "FILLED" ? updatedAt : null;
      await Promise.all([
        db
          .from("orders")
          .update({
            status,
            broker_order_id: String(brokerOrder.id),
            filled_quantity: filledQuantity,
            average_fill_price: averageFillPrice,
            updated_at: updatedAt,
          })
          .eq("id", platformOrder.id)
          .eq("user_id", ownerId),
        db
          .from("paper_execution_requests")
          .update({
            status,
            broker_order_id: String(brokerOrder.id),
            broker_acknowledged_at: acknowledgedAt,
            filled_at: filledAt,
            filled_quantity: filledQuantity,
            average_fill_price: averageFillPrice,
            completed_at: ["FILLED", "REJECTED", "CANCELED"].includes(status)
              ? updatedAt
              : null,
            updated_at: updatedAt,
          })
          .eq("user_id", ownerId)
          .eq("client_order_id", String(brokerOrder.client_order_id)),
      ]);
      if (priorRequest?.status !== status) {
        const eventType =
          status === "FILLED"
            ? "ORDER_FILLED"
            : status === "REJECTED"
              ? "ORDER_REJECTED"
              : status === "CANCELED"
                ? "ORDER_CANCELED"
                : status === "ACCEPTED"
                  ? "ORDER_ACCEPTED"
                  : null;
        if (eventType)
          await enqueueNotification(ownerId, {
            type: eventType,
            category: "TRADE",
            severity: status === "REJECTED" ? "WARNING" : "INFO",
            title: `${symbol} PAPER Order ${status}`,
            body: `${platformOrder.source} PAPER order is ${status.toLowerCase()}.`,
            payload: { symbol, status, orderId: platformOrder.id },
            deepLink: `/?section=Orders&order=${platformOrder.id}`,
            dedupeKey: `order:${platformOrder.id}:${status}`,
          });
      }
      if (status === "FILLED")
        await recordFilledPaperExecution(
          ownerId,
          String(brokerOrder.client_order_id),
        );
    }
  }
  const openIds = positions.map((position) => String(position.asset_id));
  for (const position of positions) {
    const id = String(position.asset_id);
    const control =
      controlMap.get(id) ??
      legacyMap.get(String(position.symbol).toUpperCase());
    const platformOrder = orderMap.get(String(position.symbol).toUpperCase());
    const automatedDecision = automatedDecisionMap.get(
      platformOrder?.automated_decision_id,
    );
    const entryRequest = executionRequestByOrder.get(platformOrder?.id);
    const automatedStrategies = Array.isArray(automatedDecision?.strategies)
      ? automatedDecision.strategies
      : [];
    const tradeOrigin =
      control?.trade_origin ??
      (String(platformOrder?.source ?? control?.source ?? "").toUpperCase() ===
      "BIG_MONEY"
        ? "BIG_MONEY"
        : String(
              platformOrder?.source ?? control?.source ?? "",
            ).toUpperCase() === "AUTO_TRADER"
          ? "AUTO_TRADER"
          : String(
                platformOrder?.source ?? control?.source ?? "",
              ).toUpperCase() === "MANUAL"
            ? "MANUAL"
            : "STANDARD");
    const plannedStop =
      control?.planned_stop ??
      control?.stop_loss ??
      entryRequest?.stop_loss ??
      null;
    const plannedTarget =
      control?.planned_target ??
      control?.take_profit ??
      entryRequest?.take_profit ??
      null;
    const protectedPosition = plannedStop != null && plannedTarget != null;
    const { data: synchronizedPosition } = await db
      .from("paper_positions")
      .upsert(
        {
          user_id: ownerId,
          broker_position_id: id,
          symbol: String(position.symbol).toUpperCase(),
          side: String(position.side) === "short" ? "SHORT" : "LONG",
          quantity: Math.abs(number(position.qty)),
          entry_price: number(position.avg_entry_price),
          current_price: number(position.current_price),
          market_value: Math.abs(number(position.market_value)),
          unrealized_pl: number(position.unrealized_pl),
          unrealized_pl_pct: number(position.unrealized_plpc) * 100,
          stop_loss: control?.stop_loss ?? entryRequest?.stop_loss ?? null,
          take_profit:
            control?.take_profit ?? entryRequest?.take_profit ?? null,
          planned_stop: plannedStop,
          planned_target: plannedTarget,
          protection_status: protectedPosition ? "PROTECTED" : "UNPROTECTED",
          protection_type: protectedPosition ? "WORKER_MONITORED" : null,
          protection_verified_at: asOf,
          maximum_hold_minutes:
            tradeOrigin === "AUTO_TRADER"
              ? autoConfig?.maximumHoldMinutes
              : null,
          strategy_name:
            control?.strategy_name ??
            (automatedStrategies.length
              ? String(automatedStrategies[0])
              : tradeOrigin === "BIG_MONEY"
                ? "Big Money"
                : tradeOrigin === "AUTO_TRADER"
                  ? "Combined Opportunity Engine"
                  : "Manual / External PAPER"),
          trade_origin: tradeOrigin,
          paper_test_mode: Boolean(
            control?.paper_test_mode ?? entryRequest?.paper_test_mode,
          ),
          test_slot: control?.test_slot ?? entryRequest?.test_slot ?? null,
          broker_order_id:
            control?.broker_order_id ?? platformOrder?.broker_order_id ?? null,
          entry_order_id: platformOrder?.id ?? control?.entry_order_id ?? null,
          risk_decision_id:
            control?.risk_decision_id ??
            automatedDecision?.risk_decision_id ??
            null,
          status: "OPEN",
          opened_at:
            control?.status === "CLOSED" ? asOf : (control?.opened_at ?? asOf),
          last_synced_at: asOf,
        },
        { onConflict: "user_id,broker_position_id" },
      )
      .select("id")
      .single();
    if (platformOrder && synchronizedPosition)
      await db
        .from("paper_execution_requests")
        .update({ position_id: synchronizedPosition.id, updated_at: asOf })
        .eq("user_id", ownerId)
        .eq("order_id", platformOrder.id);
    const price = number(position.current_price);
    const isLong = String(position.side) !== "short";
    const stopTriggered =
      plannedStop != null &&
      (isLong ? price <= number(plannedStop) : price >= number(plannedStop));
    const targetTriggered =
      plannedTarget != null &&
      (isLong
        ? price >= number(plannedTarget)
        : price <= number(plannedTarget));
    let exitReason = stopTriggered
      ? "STOP_LOSS"
      : targetTriggered
        ? "TAKE_PROFIT"
        : null;
    if (tradeOrigin === "AUTO_TRADER" && autoConfig) {
      const signal = signalMap.get(
        `${String(position.symbol).toUpperCase()}:${String(control?.strategy_name ?? "Combined Opportunity Engine")}`,
      );
      exitReason = evaluateIntradayExit({
        now: new Date(asOf),
        openedAt: control?.opened_at ?? asOf,
        schedule: autoSchedule,
        stopTriggered,
        targetTriggered,
        emergencyStop: Boolean(ownerSystem?.emergency_stop_active),
        riskExit: ownerSystem?.risk_state === "LOCKED",
        originalDirection: String(position.side) === "short" ? "SELL" : "BUY",
        currentDirection: signal?.direction,
        currentScore: signal?.score == null ? null : number(signal.score),
        strategyValid: signal
          ? !/INVALID|FAILED|NO VALID DATA/i.test(
              String(signal.reasoning ?? ""),
            )
          : undefined,
      });
      if (
        isOvernightViolation(
          control?.opened_at ?? asOf,
          new Date(asOf),
          autoConfig.sessionTimezone,
        )
      )
        exitReason = "END_OF_SESSION";
    }
    if (
      !protectedPosition &&
      ["AUTO_TRADER", "BIG_MONEY"].includes(tradeOrigin)
    )
      await enqueueNotification(ownerId, {
        type: "PROTECTIVE_EXIT_FAILURE",
        category: "RISK",
        severity: "CRITICAL",
        title: `${String(position.symbol).toUpperCase()} PAPER Position Unprotected`,
        body: "Expected stop/target protection is missing. Worker monitoring remains active and owner attention is required.",
        payload: { symbol: String(position.symbol).toUpperCase(), tradeOrigin },
        deepLink: "/?section=Portfolio",
        dedupeKey: `protection:missing:${ownerId}:${id}`,
      });
    if (exitReason)
      await submitProtectivePaperExit(ownerId, position, exitReason);
  }
  for (const prior of controls ?? [])
    if (!openIds.includes(prior.broker_position_id)) {
      const exitFill = fills
        .filter(
          (fill) =>
            String(fill.symbol).toUpperCase() ===
              String(prior.symbol).toUpperCase() &&
            String(fill.side).toUpperCase() ===
              (prior.side === "SHORT" ? "BUY" : "SELL") &&
            Date.parse(String(fill.transaction_time ?? asOf)) >=
              Date.parse(String(prior.opened_at ?? asOf)),
        )
        .sort(
          (a, b) =>
            Date.parse(String(b.transaction_time ?? asOf)) -
            Date.parse(String(a.transaction_time ?? asOf)),
        )[0];
      const closedPosition = (
        await db
          .from("paper_positions")
          .select("*")
          .eq("user_id", ownerId)
          .eq("broker_position_id", prior.broker_position_id)
          .maybeSingle()
      ).data;
      if (closedPosition && exitFill) {
        const direction = closedPosition.side === "SHORT" ? "SHORT" : "LONG";
        const quantity = number(closedPosition.quantity);
        const entryPrice = number(closedPosition.entry_price);
        const exitPrice = number(exitFill.price);
        const grossPl =
          (exitPrice - entryPrice) *
          quantity *
          (direction === "SHORT" ? -1 : 1);
        const tradeOrigin = ["BIG_MONEY", "AUTO_TRADER", "MANUAL"].includes(
          closedPosition.trade_origin,
        )
          ? closedPosition.trade_origin
          : "STANDARD";
        const classification =
          tradeOrigin === "BIG_MONEY"
            ? "BIG"
            : tradeOrigin === "AUTO_TRADER"
              ? "SMALL"
              : "STANDARD";
        const { data: completedTrade } = await db
          .from("completed_paper_trades")
          .upsert(
            {
              user_id: ownerId,
              lifecycle_key: `${prior.broker_position_id}:${String(closedPosition.opened_at ?? asOf)}`,
              broker_position_id: prior.broker_position_id,
              broker_order_id: closedPosition.broker_order_id,
              entry_order_id: closedPosition.entry_order_id,
              symbol: closedPosition.symbol,
              classification,
              trade_origin: tradeOrigin,
              strategy_name: closedPosition.strategy_name,
              direction,
              quantity,
              entry_price: entryPrice,
              entry_timestamp: closedPosition.opened_at ?? asOf,
              exit_price: exitPrice,
              exit_timestamp: String(exitFill.transaction_time ?? asOf),
              gross_pl: grossPl,
              costs: 0,
              net_pl: grossPl,
              return_pct:
                entryPrice * quantity > 0
                  ? (grossPl / (entryPrice * quantity)) * 100
                  : 0,
              stop_loss: closedPosition.stop_loss,
              take_profit: closedPosition.take_profit,
              entry_reason: closedPosition.strategy_name,
              exit_reason:
                closedPosition.exit_reason ?? "BROKER_POSITION_CLOSED",
              risk_decision:
                closedPosition.risk_decision_id == null
                  ? "PAPER_RISK_CONTROLS_APPLIED"
                  : String(closedPosition.risk_decision_id),
              environment: "PAPER",
              paper_test_mode: Boolean(closedPosition.paper_test_mode),
              test_slot: closedPosition.test_slot,
              metadata: {
                brokerExecutionId: String(exitFill.id ?? exitFill.activity_id),
              },
            },
            { onConflict: "user_id,lifecycle_key" },
          )
          .select("id")
          .single();
        if (completedTrade && closedPosition.entry_order_id)
          await db
            .from("paper_execution_requests")
            .update({
              completed_trade_id: completedTrade.id,
              updated_at: asOf,
            })
            .eq("user_id", ownerId)
            .eq("order_id", closedPosition.entry_order_id);
      }
      await db
        .from("paper_positions")
        .update({ status: "CLOSED", closed_at: asOf, last_synced_at: asOf })
        .eq("user_id", ownerId)
        .eq("broker_position_id", prior.broker_position_id)
        .in("status", ["OPEN", "EXIT_PENDING"]);
    }
  const unrealized = positions.reduce(
    (sum, position) => sum + number(position.unrealized_pl),
    0,
  );
  const exposure = positions.reduce(
    (sum, position) => sum + Math.abs(number(position.market_value)),
    0,
  );
  const intradayUnrealized = positions.reduce(
    (sum, position) => sum + number(position.unrealized_intraday_pl),
    0,
  );
  const dailyEquityChange =
    number(account.equity ?? account.portfolio_value) -
    number(account.last_equity);
  const realizedToday = dailyEquityChange - intradayUnrealized;
  await db.from("paper_portfolio_current").upsert({
    user_id: ownerId,
    account_id_masked: masked(account.account_number),
    equity: number(account.equity ?? account.portfolio_value),
    cash: number(account.cash),
    buying_power: number(account.buying_power),
    realized_pl_today: realizedToday,
    unrealized_pl: unrealized,
    open_exposure: exposure,
    position_count: positions.length,
    open_order_count: orders.filter((order) =>
      ["new", "accepted", "pending_new", "partially_filled"].includes(
        String(order.status).toLowerCase(),
      ),
    ).length,
    source: "ALPACA_PAPER",
    as_of: asOf,
    updated_at: asOf,
  });
  await db.from("paper_portfolio_pl_history").upsert(
    {
      user_id: ownerId,
      sample_key: asOf.slice(0, 16),
      equity: number(account.equity ?? account.portfolio_value),
      realized_pl: realizedToday,
      unrealized_pl: unrealized,
      open_exposure: exposure,
      sampled_at: asOf,
    },
    { onConflict: "user_id,sample_key" },
  );
  if (fills.length)
    await db.from("paper_broker_fills").upsert(
      fills.map((fill) => {
        const platformOrder = orderMap.get(String(fill.symbol).toUpperCase());
        const origin = ["BIG_MONEY", "AUTO_TRADER", "MANUAL"].includes(
          String(platformOrder?.source).toUpperCase(),
        )
          ? String(platformOrder.source).toUpperCase()
          : "STANDARD";
        return {
          user_id: ownerId,
          broker_execution_id: String(fill.id ?? fill.activity_id),
          broker_order_id: String(fill.order_id ?? ""),
          symbol: String(fill.symbol).toUpperCase(),
          side: String(fill.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
          quantity: number(fill.qty),
          price: number(fill.price),
          strategy_name:
            origin === "AUTO_TRADER"
              ? "Auto Trader"
              : origin === "BIG_MONEY"
                ? "Big Money"
                : "Manual / External PAPER",
          trade_origin: origin,
          executed_at: String(fill.transaction_time ?? asOf),
          raw: fill,
        };
      }),
      { onConflict: "user_id,broker_execution_id", ignoreDuplicates: true },
    );
  for (const fill of fills) {
    const symbol = String(fill.symbol).toUpperCase();
    const remainsOpen = positions.some(
      (position) => String(position.symbol).toUpperCase() === symbol,
    );
    await enqueueNotification(ownerId, {
      type: remainsOpen ? "TRADE_OPENED" : "TRADE_CLOSED",
      category: "TRADE",
      severity: "INFO",
      title: `${symbol} PAPER Position ${remainsOpen ? "Updated" : "Closed"}`,
      body: `${String(fill.side).toUpperCase()} ${number(fill.qty)} ${symbol} filled at ${number(fill.price)} in PAPER.`,
      payload: {
        symbol,
        direction: String(fill.side).toUpperCase(),
        quantity: number(fill.qty),
        price: number(fill.price),
      },
      deepLink: "/?section=Portfolio",
      dedupeKey: `fill:${String(fill.id ?? fill.activity_id)}`,
    });
  }
}

async function processBacktestJob() {
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("backtests")
    .update({ status: "QUEUED", error: "WORKER_RESTART_RECOVERY" })
    .eq("status", "RUNNING")
    .lt("started_at", staleBefore);
  const { data: queued } = await db
    .from("backtests")
    .select("id,user_id,configuration")
    .eq("status", "QUEUED")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!queued) return;
  const { data: claimed } = await db
    .from("backtests")
    .update({
      status: "RUNNING",
      progress: 5,
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", queued.id)
    .eq("status", "QUEUED")
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  try {
    const config = queued.configuration;
    const candles = await fetchAlpacaHistoricalBars(
      config.symbol,
      config.start,
      config.end,
      config.timeframe,
    );
    await db.from("backtests").update({ progress: 45 }).eq("id", queued.id);
    const result = runHistoricalBacktest(config, candles);
    await db.from("backtest_trades").upsert(
      result.trades.map((trade, index) => ({
        backtest_id: queued.id,
        user_id: queued.user_id,
        trade_index: index,
        symbol: trade.symbol,
        strategy: trade.strategy,
        direction: trade.direction,
        entry_timestamp: trade.entryTimestamp,
        entry_price: trade.entryPrice,
        exit_timestamp: trade.exitTimestamp,
        exit_price: trade.exitPrice,
        quantity: trade.quantity,
        stop_price: trade.stop,
        target_price: trade.target,
        gross_pl: trade.grossPl,
        costs: trade.costs,
        net_pl: trade.netPl,
        return_pct: trade.returnPct,
        exit_reason: trade.exitReason,
        duration_ms: trade.durationMs,
      })),
      { onConflict: "backtest_id,trade_index" },
    );
    await db
      .from("backtests")
      .update({
        status: "COMPLETED",
        progress: 100,
        metrics: result.metrics,
        assumptions: result.assumptions,
        equity_curve: result.equityCurve,
        drawdown_curve: result.drawdownCurve,
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
    await enqueueNotification(queued.user_id, {
      type: "BACKTEST_COMPLETED",
      category: "RESEARCH",
      severity: "INFO",
      title: "Backtest Completed",
      body: `${config.symbol} ${config.strategy} historical analysis completed.`,
      payload: { backtestId: queued.id, symbol: config.symbol },
      deepLink: "/?section=Backtesting",
      dedupeKey: `backtest:completed:${queued.id}`,
    });
  } catch (error) {
    await db
      .from("backtests")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "BACKTEST_FAILED",
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
    await enqueueNotification(queued.user_id, {
      type: "BACKTEST_FAILED",
      category: "RESEARCH",
      severity: "WARNING",
      title: "Backtest Failed",
      body: "A hosted backtest failed. Trading and protective position monitoring continue independently.",
      payload: { backtestId: queued.id },
      deepLink: "/?section=Backtesting",
      dedupeKey: `backtest:failed:${queued.id}`,
    });
  }
}

const researchUniverse = (
  process.env.RESEARCH_UNIVERSE ??
  "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,NFLX,SPY,QQQ"
)
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const researchWeight = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const researchWeights = {
  technical: researchWeight("RESEARCH_WEIGHT_TECHNICAL", 25),
  fundamental: researchWeight("RESEARCH_WEIGHT_FUNDAMENTAL", 20),
  catalyst: researchWeight("RESEARCH_WEIGHT_CATALYST", 20),
  marketContext: researchWeight("RESEARCH_WEIGHT_MARKET_CONTEXT", 10),
  historical: researchWeight("RESEARCH_WEIGHT_HISTORICAL", 10),
  risk: researchWeight("RESEARCH_WEIGHT_RISK", 15),
};
if (Object.values(researchWeights).every((weight) => weight === 0))
  throw new Error("RESEARCH_WEIGHTS_REQUIRED");
async function ensureScheduledResearchJob() {
  const { data: owners } = await db.from("profiles").select("id");
  const bucketMs = Math.max(
    900_000,
    Number(process.env.RESEARCH_REFRESH_INTERVAL_MS ?? 3_600_000),
  );
  const bucket = Math.floor(Date.now() / bucketMs);
  for (const owner of owners ?? []) {
    const symbol = researchUniverse[bucket % researchUniverse.length];
    await db.from("intelligence_research_jobs").upsert(
      {
        user_id: owner.id,
        symbol,
        job_key: `scheduled:${symbol}:${bucket}`,
        status: "QUEUED",
      },
      { onConflict: "user_id,job_key", ignoreDuplicates: true },
    );
  }
}

async function processResearchJob() {
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("intelligence_research_jobs")
    .update({ status: "QUEUED", error: "WORKER_RESTART_RECOVERY" })
    .eq("status", "RUNNING")
    .lt("started_at", staleBefore);
  const { data: queued } = await db
    .from("intelligence_research_jobs")
    .select("id,user_id,symbol")
    .eq("status", "QUEUED")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!queued) return;
  const { data: claimed } = await db
    .from("intelligence_research_jobs")
    .update({
      status: "RUNNING",
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", queued.id)
    .eq("status", "QUEUED")
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  try {
    const end = new Date().toISOString(),
      start = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const [bars, newsResult, actionsResult, secResult, contextBars] =
      await Promise.all([
        fetchAlpacaHistoricalBars(queued.symbol, start, end, "1Day"),
        fetchAlpacaNews(queued.symbol).catch(() => []),
        fetchCorporateActions(queued.symbol).catch(() => []),
        fetchSecBundle(queued.symbol).catch(() => null),
        Promise.all(
          ["SPY", "QQQ", "DIA", "IWM"].map((symbol) =>
            fetchAlpacaHistoricalBars(symbol, start, end, "1Day").catch(
              () => [],
            ),
          ),
        ),
      ]);
    const last = bars.at(-1),
      asset = {
        id: queued.symbol.toLowerCase(),
        symbol: queued.symbol,
        name: queued.symbol,
        assetClass: "EQUITY",
        currency: "USD",
      };
    const strategyInput = {
      asset,
      candles: bars,
      timestamp: last.time,
      quote: {
        assetId: asset.id,
        bid: last.close,
        ask: last.close,
        last: last.close,
        asOf: last.time,
        source: "ALPACA_IEX",
        isDemo: false,
        isDelayed: false,
        provider: "ALPACA",
        feed: "IEX",
      },
    };
    const signals = defaultStrategies().map((strategy) =>
      strategy.evaluate(strategyInput),
    );
    const technicalCombined = combineStrategySignals(signals);
    const contextEvidence = contextBars
      .filter((items) => items.length >= 30)
      .map((items) => {
        const latest = items.at(-1).close,
          baseline = items.at(-20).close;
        const returns = items
          .slice(-20)
          .map((bar, index, array) =>
            index
              ? (bar.close - array[index - 1].close) / array[index - 1].close
              : 0,
          );
        const volatility =
          Math.sqrt(
            returns.reduce((sum, value) => sum + value * value, 0) /
              Math.max(1, returns.length),
          ) *
          Math.sqrt(252) *
          100;
        return { trendPct: ((latest - baseline) / baseline) * 100, volatility };
      });
    const avg = (key) =>
      contextEvidence.length
        ? contextEvidence.reduce((sum, item) => sum + item[key], 0) /
          contextEvidence.length
        : 0;
    const contextTrend = avg("trendPct"),
      contextVolatility = avg("volatility");
    const marketContext = {
      score: Math.round(
        Math.max(
          0,
          Math.min(
            100,
            50 + contextTrend * 4 - Math.max(0, contextVolatility - 30),
          ),
        ),
      ),
      confidence: Math.round((contextEvidence.length / 4) * 100),
      explanation: [
        `SPY/QQQ/DIA/IWM average 20-session trend ${contextTrend.toFixed(2)}%; annualized volatility ${contextVolatility.toFixed(2)}%.`,
      ],
      regime:
        contextVolatility > 35
          ? "ELEVATED_VOLATILITY"
          : contextTrend > 2
            ? "BULLISH_TREND"
            : contextTrend < -2
              ? "BEARISH_TREND"
              : "SIDEWAYS_CHOPPY",
    };
    const metrics = secResult ? normalizeSecFacts(secResult.facts) : [],
      filings = secResult
        ? normalizeSecFilings(secResult.submissions, secResult.cik)
        : [];
    const { data: backtests } = await db
      .from("backtests")
      .select("metrics,strategy_name,configuration")
      .eq("user_id", queued.user_id)
      .eq("status", "COMPLETED")
      .contains("configuration", { symbol: queued.symbol });
    const evidenceRows = backtests ?? [],
      evidenceMetrics = evidenceRows.map((row) => row.metrics ?? {});
    const historical = evidenceRows.length
      ? {
          score: Math.round(
            Math.max(
              0,
              Math.min(
                100,
                50 +
                  evidenceMetrics.reduce(
                    (sum, item) => sum + Number(item.expectancy ?? 0),
                    0,
                  ) /
                    evidenceRows.length,
              ),
            ),
          ),
          confidence: Math.min(100, evidenceRows.length * 20),
          explanation: [
            `${evidenceRows.length} comparable historical backtests. Past performance is not predictive.`,
          ],
          evidence: {
            comparableBacktests: evidenceRows.length,
            tradeCount: evidenceMetrics.reduce(
              (sum, item) => sum + Number(item.totalTrades ?? 0),
              0,
            ),
            winRate: avgMetric(evidenceMetrics, "winRate"),
            profitFactor: avgMetric(evidenceMetrics, "profitFactor"),
            drawdown: avgMetric(evidenceMetrics, "maximumDrawdownPct"),
            expectancy: avgMetric(evidenceMetrics, "expectancy"),
            return: avgMetric(evidenceMetrics, "totalReturnPct"),
          },
        }
      : {
          score: 0,
          confidence: 0,
          explanation: ["NO HISTORICAL EVIDENCE AVAILABLE"],
          evidence: { status: "NO HISTORICAL EVIDENCE AVAILABLE" },
        };
    const { data: portfolio } = await db
      .from("paper_portfolio_current")
      .select("equity,open_exposure")
      .eq("user_id", queued.user_id)
      .maybeSingle();
    const exposurePct =
      Number(portfolio?.equity) > 0
        ? (Number(portfolio.open_exposure) / Number(portfolio.equity)) * 100
        : 0;
    const risk = {
      score: Math.round(Math.max(0, 100 - exposurePct)),
      confidence: portfolio ? 100 : 25,
      explanation: [
        `Current PAPER exposure is ${exposurePct.toFixed(2)}% of equity.`,
      ],
    };
    const snapshot = await buildIntelligenceSnapshot(
      {
        symbol: queued.symbol,
        price: last.close,
        quoteTimestamp: last.time,
        technical: {
          score: technicalCombined.score,
          confidence: signals.length ? 100 : 0,
          explanation: signals.map(
            (signal) =>
              `${signal.strategyName}: ${signal.direction} ${signal.score}/100`,
          ),
        },
        news: newsResult,
        metrics,
        filings,
        corporateActions: actionsResult,
        marketContext,
        historical,
        risk,
        weights: researchWeights,
      },
      new OpenAIResponsesResearchProvider(),
    );
    const retrievedAt = new Date().toISOString();
    if (newsResult.length)
      await db.from("market_news").upsert(
        newsResult.map((article) => ({
          user_id: queued.user_id,
          provider_id: article.id,
          headline: article.headline,
          summary: article.summary,
          source: article.source,
          author: article.author,
          published_at: article.publishedAt,
          symbols: article.symbols,
          url: article.url,
          retrieved_at: article.retrievedAt,
          analysis: analyzeNews(article),
        })),
        { onConflict: "user_id,provider_id" },
      );
    if (metrics.length)
      await db.from("company_fundamentals").upsert(
        metrics.map((metric) => ({
          user_id: queued.user_id,
          symbol: queued.symbol,
          cik: secResult?.cik ?? "",
          metric_name: metric.name,
          value: metric.value,
          unit: metric.unit,
          period_end: metric.periodEnd || null,
          filed_at: metric.filedAt || null,
          form: metric.form || null,
          provenance: metric.provenance,
          retrieved_at: retrievedAt,
        })),
        { onConflict: "user_id,symbol,metric_name,period_end,form" },
      );
    if (filings.length)
      await db.from("sec_filings").upsert(
        filings.map((filing) => ({
          user_id: queued.user_id,
          symbol: queued.symbol,
          cik: secResult.cik,
          form: filing.form,
          filing_date: filing.filingDate,
          accession: filing.accession,
          company: filing.company,
          source_url: filing.url,
          retrieved_at: retrievedAt,
        })),
        { onConflict: "user_id,accession" },
      );
    if (actionsResult.length)
      await db.from("corporate_actions").upsert(
        actionsResult.map((action) => ({
          user_id: queued.user_id,
          provider_id: action.id,
          symbol: queued.symbol,
          action_type: action.type,
          effective_date: action.date || null,
          details: action.details,
          retrieved_at: retrievedAt,
        })),
        { onConflict: "user_id,provider_id" },
      );
    const sourceReferences = [
      ...newsResult.map((item) => ({
        provider: item.source,
        id: item.id,
        timestamp: item.publishedAt,
        url: item.url,
      })),
      ...filings.map((item) => ({
        provider: "SEC_EDGAR",
        id: item.accession,
        timestamp: item.filingDate,
        url: item.url,
      })),
    ];
    await db.from("intelligence_snapshots").insert({
      user_id: queued.user_id,
      job_id: queued.id,
      symbol: queued.symbol,
      direction: technicalCombined.direction,
      current_price: last.close,
      opportunity_score: snapshot.opportunityScore,
      confidence: snapshot.confidence,
      technical_score: snapshot.breakdown.technical,
      fundamental_score: snapshot.breakdown.fundamental,
      catalyst_score: snapshot.breakdown.catalyst,
      market_context_score: snapshot.breakdown.marketContext,
      historical_score: snapshot.breakdown.historical,
      risk_score: snapshot.breakdown.risk,
      weights: snapshot.weights,
      source_facts: snapshot.sourceFacts,
      deterministic_analysis: snapshot.deterministicAnalysis,
      ai_status: snapshot.aiStatus,
      ai_analysis: snapshot.aiReport,
      freshness: snapshot.freshness,
      source_references: sourceReferences,
      generated_at: snapshot.generatedAt,
    });
    await db
      .from("intelligence_research_jobs")
      .update({ status: "COMPLETED", completed_at: retrievedAt })
      .eq("id", queued.id);
    await enqueueNotification(queued.user_id, {
      type: "RESEARCH_OPPORTUNITY_FOUND",
      category: "RESEARCH",
      severity: "INFO",
      title: `${queued.symbol} Research Opportunity`,
      body: `${technicalCombined.direction} signal score ${snapshot.opportunityScore}/100 with ${snapshot.confidence}% confidence. Owner review is required.`,
      payload: {
        symbol: queued.symbol,
        direction: technicalCombined.direction,
        opportunityScore: snapshot.opportunityScore,
        confidence: snapshot.confidence,
        majorCatalyst:
          snapshot.deterministicAnalysis.parts.catalyst.explanation[0] ??
          "Unavailable",
        majorRisk:
          snapshot.deterministicAnalysis.parts.risk.explanation[0] ??
          "Unavailable",
        recommendedCapital: null,
        maximumPlannedLoss: null,
      },
      deepLink: `/?section=Big%20Money&research=${queued.id}`,
      dedupeKey: `research:${queued.id}`,
    });
  } catch (error) {
    await db
      .from("intelligence_research_jobs")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "RESEARCH_FAILED",
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
  }
}
const avgMetric = (rows, key) =>
  rows.length
    ? rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length
    : 0;

async function processManualExecutionRequests() {
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: staleClaims } = await db
    .from("paper_execution_requests")
    .select("id,user_id,order_id,client_order_id")
    .eq("status", "SUBMITTING")
    .lt("updated_at", staleBefore);
  for (const stale of staleClaims ?? []) {
    try {
      const brokerOrder = await json(
        `${PAPER_URL}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(stale.client_order_id)}`,
        { headers: brokerHeaders() },
      );
      const status = normalizePaperExecutionStatus(brokerOrder.status);
      const recoveredAt = new Date().toISOString();
      await Promise.all([
        db
          .from("paper_execution_requests")
          .update({
            status,
            broker_order_id: String(brokerOrder.id),
            broker_submitted_at: brokerOrder.submitted_at ?? recoveredAt,
            updated_at: recoveredAt,
          })
          .eq("id", stale.id)
          .eq("status", "SUBMITTING"),
        db
          .from("orders")
          .update({ status, broker_order_id: String(brokerOrder.id) })
          .eq("id", stale.order_id)
          .eq("user_id", stale.user_id),
      ]);
    } catch (recoveryError) {
      if (
        recoveryError instanceof Error &&
        recoveryError.message === "UPSTREAM_404"
      )
        await db
          .from("paper_execution_requests")
          .update({ status: "QUEUED", updated_at: new Date().toISOString() })
          .eq("id", stale.id)
          .eq("status", "SUBMITTING");
    }
  }
  const { data: queued, error } = await db
    .from("paper_execution_requests")
    .select("*")
    .eq("status", "QUEUED")
    .order("queued_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  for (const request of queued ?? []) {
    const receivedAt = new Date().toISOString();
    const { data: claimed } = await db
      .from("paper_execution_requests")
      .update({
        status: "SUBMITTING",
        worker_received_at: receivedAt,
        updated_at: receivedAt,
      })
      .eq("id", request.id)
      .eq("status", "QUEUED")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    try {
      const [
        { data: state },
        { data: riskDecision },
        { data: platformOrder },
        { data: quoteState },
      ] = await Promise.all([
        db
          .from("system_state")
          .select("mode,risk_state,emergency_stop_active")
          .eq("user_id", request.user_id)
          .maybeSingle(),
        db
          .from("risk_decisions")
          .select("decision")
          .eq("user_id", request.user_id)
          .eq("client_order_id", request.client_order_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("orders")
          .select("id")
          .eq("id", request.order_id)
          .eq("user_id", request.user_id)
          .maybeSingle(),
        db
          .from("paper_market_quotes")
          .select("market_session,as_of")
          .eq("user_id", request.user_id)
          .eq("symbol", request.symbol)
          .maybeSingle(),
      ]);
      if (
        state?.mode !== "PAPER" ||
        state?.emergency_stop_active ||
        state?.risk_state === "LOCKED" ||
        riskDecision?.decision !== "APPROVED" ||
        !platformOrder
      )
        throw new Error("RISK_REJECTED");
      if (request.order_type === "MARKET") {
        if (quoteState?.market_session === "CLOSED")
          throw new Error("MARKET_CLOSED");
        if (
          quoteState?.market_session === "PRE_MARKET" ||
          quoteState?.market_session === "AFTER_HOURS"
        )
          throw new Error("ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION");
        const quoteAgeMs = Date.now() - Date.parse(quoteState?.as_of ?? "");
        if (!Number.isFinite(quoteAgeMs) || quoteAgeMs > 120_000)
          throw new Error("STALE_DATA");
      }
      const response = await json(`${PAPER_URL}/v2/orders`, {
        method: "POST",
        headers: { ...brokerHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          symbol: request.symbol,
          qty: String(request.quantity),
          side: String(request.direction).toLowerCase(),
          type: String(request.order_type).toLowerCase(),
          time_in_force: "day",
          client_order_id: request.client_order_id,
          ...(request.order_type === "LIMIT"
            ? { limit_price: String(request.limit_price) }
            : {}),
        }),
      });
      const status = normalizePaperExecutionStatus(response.status);
      const submittedAt = new Date().toISOString();
      const filledQuantity = number(response.filled_qty);
      const averageFillPrice = number(response.filled_avg_price) || null;
      await Promise.all([
        db
          .from("paper_execution_requests")
          .update({
            status,
            broker_order_id: String(response.id),
            broker_submitted_at: submittedAt,
            broker_acknowledged_at:
              response.accepted_at ?? response.submitted_at ?? submittedAt,
            filled_at: status === "FILLED" ? submittedAt : null,
            filled_quantity: filledQuantity,
            average_fill_price: averageFillPrice,
            completed_at: ["FILLED", "REJECTED", "CANCELED"].includes(status)
              ? submittedAt
              : null,
            updated_at: submittedAt,
          })
          .eq("id", request.id),
        db
          .from("orders")
          .update({
            status,
            broker_order_id: String(response.id),
            filled_quantity: filledQuantity,
            average_fill_price: averageFillPrice,
            updated_at: submittedAt,
          })
          .eq("id", request.order_id)
          .eq("user_id", request.user_id),
        db.from("audit_events").insert({
          user_id: request.user_id,
          action: "PAPER_ORDER_RAILWAY_SUBMITTED",
          metadata: {
            mode: "PAPER",
            execution_request_id: request.id,
            client_order_id: request.client_order_id,
            broker_order_id: String(response.id),
            status,
          },
        }),
      ]);
      if (["ACCEPTED", "FILLED", "REJECTED", "CANCELED"].includes(status))
        await enqueueNotification(request.user_id, {
          type: `ORDER_${status}`,
          category: "TRADE",
          severity: status === "REJECTED" ? "WARNING" : "INFO",
          title: `${request.symbol} PAPER Order ${status}`,
          body: `${request.source} PAPER order is ${status.toLowerCase()}.`,
          payload: {
            symbol: request.symbol,
            status,
            orderId: request.order_id,
          },
          deepLink: `/?section=Orders&order=${request.order_id}`,
          dedupeKey: `order:${request.order_id}:${status}`,
        });
      if (status === "FILLED")
        await recordFilledPaperExecution(
          request.user_id,
          request.client_order_id,
        );
    } catch (executionError) {
      const riskRejected =
        executionError instanceof Error &&
        executionError.message === "RISK_REJECTED";
      const { code, message } = riskRejected
        ? {
            code: "RISK_REJECTED",
            message:
              "Risk or trade permission changed before broker submission.",
          }
        : safePaperExecutionFailure(executionError);
      const failedAt = new Date().toISOString();
      await Promise.all([
        db
          .from("paper_execution_requests")
          .update({
            status:
              riskRejected || code === "ORDER_REJECTED" ? "REJECTED" : "FAILED",
            error_code: code,
            error_message: message,
            completed_at: failedAt,
            updated_at: failedAt,
          })
          .eq("id", request.id),
        db
          .from("orders")
          .update({
            status:
              riskRejected || code === "ORDER_REJECTED" ? "REJECTED" : "FAILED",
          })
          .eq("id", request.order_id)
          .eq("user_id", request.user_id),
      ]);
    }
  }
}

async function recordFilledPaperExecution(ownerId, clientOrderId) {
  const countedAt = new Date().toISOString();
  const { data: claimed } = await db
    .from("paper_execution_requests")
    .update({ risk_counted_at: countedAt, updated_at: countedAt })
    .eq("user_id", ownerId)
    .eq("client_order_id", clientOrderId)
    .is("risk_counted_at", null)
    .select("id")
    .maybeSingle();
  if (claimed) await db.rpc("record_paper_trade_open", { p_user_id: ownerId });
}

async function persistOwnerQuotes(ownerId, snapshots, asOf, clock, calendar) {
  const normalizedClock = {
    isOpen: Boolean(clock?.is_open),
    nextOpen: clock?.next_open ?? null,
    nextClose: clock?.next_close ?? null,
    observedAt: asOf,
    isTradingDay: Array.isArray(calendar) && calendar.length > 0,
  };
  const marketSession = classifyEquityMarketSession(normalizedClock);
  const rows = Object.entries(snapshots ?? {}).flatMap(([symbol, snapshot]) => {
    const last = number(
      snapshot?.latestTrade?.p ??
        snapshot?.minuteBar?.c ??
        snapshot?.dailyBar?.c,
    );
    if (!last) return [];
    return [
      {
        user_id: ownerId,
        symbol: symbol.toUpperCase(),
        bid: number(snapshot?.latestQuote?.bp) || last,
        ask: number(snapshot?.latestQuote?.ap) || last,
        last,
        provider: "ALPACA",
        feed: "IEX",
        as_of: snapshot?.latestTrade?.t ?? snapshot?.minuteBar?.t ?? asOf,
        market_session: marketSession,
        clock_observed_at: asOf,
        is_trading_day: normalizedClock.isTradingDay,
        next_open: normalizedClock.nextOpen,
        next_close: normalizedClock.nextClose,
        updated_at: asOf,
      },
    ];
  });
  if (rows.length)
    await db.from("paper_market_quotes").upsert(rows, {
      onConflict: "user_id,symbol",
    });
}

async function cycle() {
  const startedAt = new Date().toISOString();
  await ensureScheduledResearchJob();
  await processResearchJob();
  await processBacktestJob();
  const { data: owners, error } = await db.from("profiles").select("id");
  if (error) throw error;
  const marketDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [
    account,
    positions,
    orders,
    fills,
    portfolioHistory,
    snapshots,
    clock,
    calendar,
  ] = await Promise.all([
    json(`${PAPER_URL}/v2/account`, {
      headers: brokerHeaders(),
    }),
    json(`${PAPER_URL}/v2/positions`, {
      headers: brokerHeaders(),
    }),
    json(`${PAPER_URL}/v2/orders?status=all&direction=desc&limit=100`, {
      headers: brokerHeaders(),
    }),
    json(
      `${PAPER_URL}/v2/account/activities/FILL?direction=desc&page_size=100`,
      { headers: brokerHeaders() },
    ),
    json(`${PAPER_URL}/v2/account/portfolio/history?period=1D&timeframe=1Min`, {
      headers: brokerHeaders(),
    }),
    json(
      `${DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`,
      {
        headers: headers(
          process.env.ALPACA_API_KEY,
          process.env.ALPACA_API_SECRET,
        ),
      },
    ),
    json(`${PAPER_URL}/v2/clock`, { headers: brokerHeaders() }),
    json(`${PAPER_URL}/v2/calendar?start=${marketDate}&end=${marketDate}`, {
      headers: brokerHeaders(),
    }),
  ]);
  for (const owner of owners ?? [])
    await persistOwnerQuotes(owner.id, snapshots, startedAt, clock, calendar);
  await processManualExecutionRequests();
  for (const owner of owners ?? []) {
    const { data: state } = await db
      .from("system_state")
      .select("auto_trader_status,emergency_stop_active")
      .eq("user_id", owner.id)
      .maybeSingle();
    const autoTraderPermitted =
      state?.auto_trader_status === "ACTIVE" &&
      state?.emergency_stop_active === false;
    await synchronizeOwnerPortfolio(
      owner.id,
      account,
      positions,
      orders,
      fills,
      portfolioHistory,
      startedAt,
    );
    try {
      const { data: stressConfig } = await db
        .from("auto_trader_config")
        .select(
          "paper_test_mode,paper_test_target_auto_positions,maximum_concurrent_positions",
        )
        .eq("user_id", owner.id)
        .maybeSingle();
      const attempts = stressConfig?.paper_test_mode
        ? Math.min(
            number(stressConfig.paper_test_target_auto_positions ?? 8),
            number(stressConfig.maximum_concurrent_positions ?? 8),
          )
        : 1;
      for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1)
        await processAutonomousOwner(owner.id, account, positions);
      await processBigMoneyTestOwner(owner.id, account, positions);
    } catch (error) {
      await enqueueNotification(owner.id, {
        type: "RISK_MANAGER_WARNING",
        category: "RISK",
        severity: "WARNING",
        title: "Autonomous PAPER Cycle Degraded",
        body: "A hosted autonomous entry cycle failed safely. Existing position protection continues.",
        payload: {
          code:
            error instanceof Error ? error.message : "AUTONOMOUS_CYCLE_FAILED",
        },
        deepLink: "/?section=Auto%20Trader",
        dedupeKey: `auto-cycle-failed:${startedAt.slice(0, 13)}`,
      });
    }
    const metadata = {
      accountStatus: account?.status ?? "UNKNOWN",
      positionCount: positions?.length ?? 0,
      openOrderCount: orders?.length ?? 0,
      scannedSymbols: Object.keys(snapshots ?? {}),
      marketData: "ALPACA_IEX",
      broker: "ALPACA_PAPER",
      autoTrader: autoTraderPermitted ? "SCHEDULED" : "PAUSED",
      safety: "LIVE_LOCKED",
    };
    await db.from("trading_worker_heartbeats").upsert(
      {
        user_id: owner.id,
        worker_id: workerId,
        status: "ONLINE",
        runtime: "HOSTED_PRODUCTION",
        last_seen_at: new Date().toISOString(),
        version: process.env.WORKER_VERSION ?? "TRADE-011",
        metadata,
      },
      { onConflict: "user_id,worker_id" },
    );
    await db
      .from("trading_worker_runs")
      .insert({
        user_id: owner.id,
        worker_id: workerId,
        task_type: "HOSTED_CYCLE",
        idempotency_key: `${workerId}:${owner.id}:${startedAt.slice(0, 16)}`,
        status: "COMPLETED",
        details: metadata,
      })
      .then(() => undefined);
    await db.from("broker_reconciliation_runs").insert({
      user_id: owner.id,
      account,
      positions,
      orders,
      fills,
      differences: [],
      status: "ALPACA_AUTHORITATIVE_RECONCILED",
    });
  }
}

async function loop() {
  try {
    await cycle();
    console.log(
      JSON.stringify({
        level: "info",
        event: "worker_cycle_complete",
        at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "worker_cycle_failed",
        message: error instanceof Error ? error.message : "UNKNOWN",
        at: new Date().toISOString(),
      }),
    );
  }
  if (!stopping) setTimeout(loop, intervalMs);
}
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await loop();
