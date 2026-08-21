import { NextResponse } from "next/server";
import type {
  Asset,
  AutomatedDecisionResult,
  AutoTraderConfig,
  BrokerOrderRequest,
  RiskSettings,
  SystemState,
  TradeRiskContext,
} from "@/src/domain/models";
import {
  defaultAutoTraderConfig,
  defaultRiskSettings,
} from "@/src/config/trading";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { AutoTraderEngine } from "@/src/services/auto-trader";
import { loadBrokerDashboard } from "@/src/services/broker/dashboard";
import { createPaperBroker } from "@/src/services/broker/factory";
import { GuardedPaperBrokerService } from "@/src/services/broker/guarded-paper-broker-service";
import { SimulatedPaperBrokerService } from "@/src/services/broker/simulated-paper-broker-service";
import { MarketDataEngine } from "@/src/services/market-data-engine";
import { createPaperMarketData } from "@/src/services/market-data/factory";
import { ProductionRiskManager } from "@/src/services/risk-manager";
import { CombinedOpportunityEngine } from "@/src/services/strategies/combined-opportunity-engine";
import { TradePermissionService } from "@/src/services/trade-permission";
import { normalizeDatabaseTime } from "@/src/services/config-time";
import { applyPaperTestThresholds } from "@/src/services/paper-automation-test";
import { canOpenIntradayEntry } from "@/src/services/intraday-lifecycle";

const assets: Record<string, Asset> = Object.fromEntries(
  [
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
  ].map((symbol) => [
    symbol,
    {
      id: symbol.toLowerCase(),
      symbol,
      name: symbol,
      assetClass: "EQUITY" as const,
      currency: "USD",
    },
  ]),
);

const mapConfig = (row: Record<string, unknown> | null): AutoTraderConfig =>
  row
    ? {
        enabled: Boolean(row.enabled),
        capitalAllocation: Number(row.capital_allocation),
        maximumTradeSize: Number(row.maximum_trade_size),
        maximumRiskPerTrade: Number(row.maximum_risk_per_trade),
        dailyLossLimit: Number(row.daily_loss_limit),
        dailyProfitTarget: Number(row.daily_profit_target),
        maximumTradesPerDay: Number(row.maximum_trades_per_day),
        maximumConcurrentPositions: Number(row.maximum_concurrent_positions),
        minimumStrategyScore: Number(row.minimum_strategy_score),
        allowedStrategies: row.allowed_strategies as string[],
        allowedAssets: row.allowed_assets as string[],
        riskProfile: String(
          row.risk_profile,
        ) as AutoTraderConfig["riskProfile"],
        maximumPortfolioExposure: Number(row.maximum_portfolio_exposure),
        minimumOpportunityScore: Number(row.minimum_opportunity_score),
        minimumConfidence: Number(row.minimum_confidence),
        minimumHistoricalScore: Number(row.minimum_historical_score),
        longEnabled: Boolean(row.long_enabled),
        shortEnabled: Boolean(row.short_enabled),
        sessionStart: normalizeDatabaseTime(row.session_start, "09:30"),
        sessionEnd: normalizeDatabaseTime(row.session_end, "16:00"),
        sessionTimezone: String(row.session_timezone ?? "America/New_York"),
        entryStart: normalizeDatabaseTime(row.entry_start, "09:35"),
        lastEntryTime: normalizeDatabaseTime(row.last_entry_time, "15:15"),
        forceExitTime: normalizeDatabaseTime(row.force_exit_time, "15:50"),
        maximumHoldMinutes:
          row.maximum_hold_minutes == null
            ? null
            : Number(row.maximum_hold_minutes),
        minimumExitScore: Number(row.minimum_exit_score ?? 45),
        strategyHealthMinimumSample: Number(
          row.strategy_health_minimum_sample ?? 20,
        ),
        cooldownMinutes: Number(row.cooldown_minutes),
        lossCooldownMinutes: Number(row.loss_cooldown_minutes),
        paperTestMode: row.paper_test_mode === true,
        paperTestTargetAutoPositions: Number(
          row.paper_test_target_auto_positions ?? 8,
        ),
        paperBigMoneyTestMode: Boolean(row.paper_big_money_test_mode),
        paperTestTargetBigMoneyPositions: Number(
          row.paper_test_target_big_money_positions ?? 2,
        ),
        paperBigMoneyAutoApproveTest: Boolean(
          row.paper_big_money_auto_approve_test,
        ),
        paperTestMinimumOpportunityScore: Number(
          row.paper_test_min_opportunity_score ?? 60,
        ),
        paperTestMinimumConfidence: Number(row.paper_test_min_confidence ?? 50),
        paperTestMaximumPositionSize: Number(
          row.paper_test_max_position_size ?? 1000,
        ),
        paperTestMaximumRiskPerTrade: Number(
          row.paper_test_max_risk_per_trade ?? 100,
        ),
        paperTestMaximumDailyTrades: Number(
          row.paper_test_max_daily_trades ?? 30,
        ),
        paperTestUniverse:
          (row.paper_test_universe as string[]) ??
          defaultAutoTraderConfig.paperTestUniverse,
      }
    : defaultAutoTraderConfig;

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json({
      config: defaultAutoTraderConfig,
      daily: null,
      decisions: [],
      systemStatus: "PAUSED",
    });
  const today = new Date().toISOString().slice(0, 10);
  const [
    config,
    daily,
    decisions,
    system,
    heartbeat,
    candidates,
    recentOrders,
    testPositions,
    testTrades,
    testCycle,
  ] = await Promise.all([
    supabase
      .from("auto_trader_config")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("auto_trader_daily_state")
      .select("*")
      .eq("user_id", user.id)
      .eq("trading_date", today)
      .maybeSingle(),
    supabase
      .from("automated_decisions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("system_state")
      .select("mode,auto_trader_status,risk_state,emergency_stop_active")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("trading_worker_heartbeats")
      .select("last_seen_at,metadata")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("autonomous_candidate_evaluations")
      .select("decision,reasons,created_at,symbol")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("paper_execution_requests")
      .select("status,queued_at,filled_at,symbol,error_message")
      .eq("user_id", user.id)
      .eq("source", "AUTO_TRADER")
      .order("queued_at", { ascending: false })
      .limit(20),
    supabase
      .from("paper_positions")
      .select(
        "symbol,trade_origin,market_value,unrealized_pl,broker_position_id,protection_status",
      )
      .eq("user_id", user.id)
      .in("status", ["OPEN", "EXIT_PENDING"]),
    supabase
      .from("completed_paper_trades")
      .select("strategy_name,symbol,exit_reason")
      .eq("user_id", user.id)
      .eq("paper_test_mode", true)
      .limit(5000),
    supabase
      .from("paper_automation_test_cycles")
      .select("status,metrics,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (config.error)
    return NextResponse.json(
      {
        error: "AUTO_TRADER_CONFIG_LOAD_FAILED",
        detail: config.error.message,
        requiredMigration:
          "202608200003_trade_018_1_paper_test_persistence_hotfix",
      },
      { status: 503 },
    );
  const authoritativeStatus = system.data?.emergency_stop_active
    ? "LOCKED"
    : (system.data?.auto_trader_status ?? "PAUSED");
  return NextResponse.json({
    config: {
      ...mapConfig(config.data),
      enabled: authoritativeStatus === "ACTIVE",
    },
    daily: daily.data,
    decisions: decisions.data ?? [],
    systemStatus: authoritativeStatus,
    workerAcknowledged:
      heartbeat.data?.metadata?.autoTrader ===
      (authoritativeStatus === "ACTIVE" ? "SCHEDULED" : "PAUSED"),
    workerLastSeen: heartbeat.data?.last_seen_at ?? null,
    activePositions: Number(heartbeat.data?.metadata?.positionCount ?? 0),
    activity: {
      current:
        authoritativeStatus !== "ACTIVE"
          ? "PAUSED"
          : recentOrders.data?.some((order) =>
                ["QUEUED", "SUBMITTING"].includes(order.status),
              )
            ? "ORDER QUEUED"
            : recentOrders.data?.some((order) =>
                  ["SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"].includes(
                    order.status,
                  ),
                )
              ? "WAITING FOR FILL"
              : Number(heartbeat.data?.metadata?.positionCount ?? 0) > 0
                ? "POSITION ACTIVE"
                : "SCANNING / WAITING FOR SETUP",
      lastScan: heartbeat.data?.last_seen_at ?? null,
      candidatesEvaluated: candidates.data?.length ?? 0,
      candidatesRejected:
        candidates.data?.filter(
          (candidate) => candidate.decision === "REJECTED",
        ).length ?? 0,
      lastRejectionReason:
        candidates.data?.find((candidate) => candidate.decision === "REJECTED")
          ?.reasons?.[0] ?? null,
      lastOrderQueued: recentOrders.data?.[0]?.queued_at ?? null,
      lastOrderFilled:
        recentOrders.data?.find((order) => order.status === "FILLED")
          ?.filled_at ?? null,
    },
    paperTest: {
      active: mapConfig(config.data).paperTestMode,
      autoPositions: (testPositions.data ?? []).filter(
        (position) =>
          position.trade_origin === "AUTO_TRADER" &&
          position.broker_position_id,
      ).length,
      bigMoneyPositions: (testPositions.data ?? []).filter(
        (position) =>
          position.trade_origin === "BIG_MONEY" && position.broker_position_id,
      ).length,
      totalActive: (testPositions.data ?? []).filter(
        (position) => position.broker_position_id,
      ).length,
      capitalInMarket: (testPositions.data ?? []).reduce(
        (sum, position) => sum + Math.abs(Number(position.market_value ?? 0)),
        0,
      ),
      openPl: (testPositions.data ?? []).reduce(
        (sum, position) => sum + Number(position.unrealized_pl ?? 0),
        0,
      ),
      unprotected: (testPositions.data ?? []).filter(
        (position) => position.protection_status === "UNPROTECTED",
      ).length,
      strategyCoverage: (testTrades.data ?? []).reduce<Record<string, number>>(
        (coverage, trade) => ({
          ...coverage,
          [trade.strategy_name]: (coverage[trade.strategy_name] ?? 0) + 1,
        }),
        {},
      ),
      symbolCoverage: (testTrades.data ?? []).reduce<Record<string, number>>(
        (coverage, trade) => ({
          ...coverage,
          [trade.symbol]: (coverage[trade.symbol] ?? 0) + 1,
        }),
        {},
      ),
      seekingPositions: Number(
        testCycle.data?.metrics?.seekingPositions ??
          Math.max(
            0,
            mapConfig(config.data).paperTestTargetAutoPositions -
              (testPositions.data ?? []).filter(
                (position) =>
                  position.trade_origin === "AUTO_TRADER" &&
                  position.broker_position_id,
              ).length,
          ),
      ),
      lastBlockReason:
        testCycle.data?.metrics?.lastBlockReason ??
        (testCycle.data?.status === "WAITING_FOR_SESSION"
          ? "MARKET_CLOSED"
          : null),
      cycleId: testCycle.data?.metrics?.cycleId ?? null,
      persistenceTrace: {
        reloadedValue: mapConfig(config.data).paperTestMode,
        workerValue:
          typeof heartbeat.data?.metadata?.paperTestMode === "boolean"
            ? heartbeat.data.metadata.paperTestMode
            : null,
        targetReloaded: mapConfig(config.data).paperTestTargetAutoPositions,
        targetWorker:
          typeof heartbeat.data?.metadata?.paperTestTargetAutoPositions ===
          "number"
            ? heartbeat.data.metadata.paperTestTargetAutoPositions
            : null,
      },
    },
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  const body = (await request.json()) as {
    action?: "CONFIGURE" | "RUN" | "PAUSE" | "RESUME";
    config?: AutoTraderConfig;
    symbol?: string;
  };
  if (body.action === "CONFIGURE" && body.config) {
    if (!validConfig(body.config))
      return NextResponse.json(
        { error: "Invalid Auto Trader configuration." },
        { status: 400 },
      );
    try {
      const persisted = await upsertConfig(supabase, user.id, body.config);
      const [
        { data: reloaded, error: reloadError },
        { count: ownerRowCount },
        { data: worker },
      ] = await Promise.all([
        supabase
          .from("auto_trader_config")
          .select("*")
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("auto_trader_config")
          .select("user_id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("trading_worker_heartbeats")
          .select("metadata,last_seen_at")
          .eq("user_id", user.id)
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (reloadError || !reloaded)
        throw new Error(reloadError?.message ?? "CONFIG_RELOAD_FAILED");
      const reloadedConfig = mapConfig(reloaded);
      if (reloadedConfig.paperTestMode !== body.config.paperTestMode)
        throw new Error("PAPER_TEST_MODE_RELOAD_MISMATCH");
      if (ownerRowCount !== 1)
        throw new Error("OWNER_CONFIG_ROW_COUNT_INVALID");
      return NextResponse.json({
        config: reloadedConfig,
        persisted: true,
        mode: "PAPER",
        persistenceTrace: {
          submittedValue: body.config.paperTestMode,
          persistedValue: persisted.paperTestMode,
          reloadedValue: reloadedConfig.paperTestMode,
          workerValue:
            typeof worker?.metadata?.paperTestMode === "boolean"
              ? worker.metadata.paperTestMode
              : null,
          ownerRowCount,
          column: "paper_test_mode",
          conflictKey: "user_id",
          workerLastSeen: worker?.last_seen_at ?? null,
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "AUTO_TRADER_CONFIG_PERSISTENCE_FAILED",
          detail:
            error instanceof Error ? error.message : "UNKNOWN_DATABASE_ERROR",
          requiredMigration:
            "202608200003_trade_018_1_paper_test_persistence_hotfix",
        },
        { status: 503 },
      );
    }
  }
  if (body.action === "PAUSE" || body.action === "RESUME") {
    const [{ data: system }, { data: storedConfig }] = await Promise.all([
      supabase
        .from("system_state")
        .select("mode,risk_state,emergency_stop_active")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("auto_trader_config")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (body.action === "RESUME" && system?.emergency_stop_active)
      return NextResponse.json(
        { error: "Emergency Stop is active." },
        { status: 423 },
      );
    if (body.action === "RESUME" && system?.mode !== "PAPER")
      return NextResponse.json(
        { error: "LIVE_TRADING_LOCKED" },
        { status: 423 },
      );
    if (body.action === "RESUME" && system?.risk_state === "LOCKED")
      return NextResponse.json(
        { error: "Risk Manager is locked." },
        { status: 423 },
      );
    if (body.action === "RESUME" && !validConfig(mapConfig(storedConfig)))
      return NextResponse.json(
        { error: "Review and save a valid risk configuration first." },
        { status: 400 },
      );
    const { error: configError } = await supabase
      .from("auto_trader_config")
      .update({ enabled: body.action === "RESUME" })
      .eq("user_id", user.id);
    const { error: stateError } = await supabase.from("system_state").upsert(
      {
        user_id: user.id,
        mode: "PAPER",
        auto_trader_status: body.action === "RESUME" ? "ACTIVE" : "PAUSED",
      },
      { onConflict: "user_id" },
    );
    if (configError || stateError)
      return NextResponse.json(
        { error: "Auto Trader state could not be persisted safely." },
        { status: 503 },
      );
    await supabase.from("audit_events").insert({
      user_id: user.id,
      action:
        body.action === "RESUME" ? "AUTO_TRADER_RESUMED" : "AUTO_TRADER_PAUSED",
      metadata: { mode: "PAPER", authoritative_state: "system_state" },
    });
    return NextResponse.json({
      status: body.action === "RESUME" ? "ACTIVE" : "PAUSED",
      mode: "PAPER",
    });
  }
  if (body.action !== "RUN")
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  const symbol = body.symbol?.toUpperCase() ?? "";
  if (!assets[symbol])
    return NextResponse.json({ error: "Unsupported asset." }, { status: 400 });
  return runCycle(user.id, assets[symbol], supabase);
}

async function runCycle(
  userId: string,
  asset: Asset,
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
) {
  const today = new Date().toISOString().slice(0, 10);
  const [
    configResult,
    systemResult,
    dailyResult,
    positionsResult,
    portfolioRiskResult,
    brokerDashboard,
  ] = await Promise.all([
    supabase
      .from("auto_trader_config")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("system_state")
      .select("mode,auto_trader_status,risk_state,emergency_stop_active")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("auto_trader_daily_state")
      .select("*")
      .eq("user_id", userId)
      .eq("trading_date", today)
      .maybeSingle(),
    supabase
      .from("positions")
      .select("symbol,quantity,entry_price,current_price,source")
      .eq("user_id", userId),
    supabase
      .from("risk_portfolio_state")
      .select("drawdown_pct")
      .eq("user_id", userId)
      .maybeSingle(),
    loadBrokerDashboard(),
  ]);
  const config = applyPaperTestThresholds(mapConfig(configResult.data));
  if (
    !canOpenIntradayEntry(new Date(), {
      timezone: config.sessionTimezone,
      sessionStart: config.sessionStart,
      sessionEnd: config.sessionEnd,
      entryStart: config.entryStart,
      lastEntryTime: config.lastEntryTime,
      forceExitTime: config.forceExitTime,
      maxHoldMinutes: config.maximumHoldMinutes,
      minimumExitScore: config.minimumExitScore,
    })
  )
    return NextResponse.json(
      { error: "ENTRY_WINDOW_CLOSED", mode: "PAPER" },
      { status: 423 },
    );
  const system: SystemState = {
    mode: "PAPER",
    autoTraderStatus: systemResult.data?.auto_trader_status ?? "PAUSED",
    riskState: systemResult.data?.risk_state ?? "NORMAL",
    emergencyStopActive: systemResult.data?.emergency_stop_active ?? false,
  };
  const selected = createPaperBroker();
  const connectedBroker = brokerDashboard.source !== "DEMO" ? selected : null;
  if (config.paperTestMode && !connectedBroker)
    return NextResponse.json(
      { error: "BROKER_UNAVAILABLE", mode: "PAPER" },
      { status: 503 },
    );
  const rawBroker = connectedBroker
    ? connectedBroker.broker
    : new SimulatedPaperBrokerService();
  const guardedBroker = new GuardedPaperBrokerService(rawBroker, async () => {
    const { data } = await supabase
      .from("system_state")
      .select("emergency_stop_active,auto_trader_status")
      .eq("user_id", userId)
      .maybeSingle();
    return (
      !data?.emergency_stop_active && data?.auto_trader_status === "ACTIVE"
    );
  });
  const marketProvider = createPaperMarketData();
  const riskSettings: RiskSettings = {
    ...defaultRiskSettings,
    autoTraderEnabled: config.enabled,
    autoTraderAllocatedCapital: config.capitalAllocation,
    maximumCapitalPerTrade: config.maximumTradeSize,
    maximumRiskPerTrade: config.maximumRiskPerTrade,
    dailyMaximumLoss: config.dailyLossLimit,
    dailyProfitTarget: config.dailyProfitTarget,
    maximumTradesPerDay: config.maximumTradesPerDay,
    maximumConcurrentPositions: config.maximumConcurrentPositions,
  };
  let claimedDecisionId: string | null = null;
  let latestRiskDecisionId: string | null = null;
  const rows = positionsResult.data ?? [];
  const exposure = rows.reduce(
    (sum, row) =>
      sum + Number(row.quantity) * Number(row.current_price ?? row.entry_price),
    0,
  );
  const autoExposure = rows
    .filter((row) => row.source === "AUTO_TRADER")
    .reduce(
      (sum, row) =>
        sum +
        Number(row.quantity) * Number(row.current_price ?? row.entry_price),
      0,
    );
  const risk = new ProductionRiskManager(
    riskSettings,
    async (context, decision) => {
      const { data } = await supabase
        .from("risk_decisions")
        .insert({
          user_id: userId,
          client_order_id: claimedDecisionId,
          symbol: asset.symbol,
          source: "AUTO_TRADER",
          decision: decision.status,
          reason: decision.reason,
          requested_capital: decision.requestedCapital,
          approved_capital: decision.approvedCapital,
          calculated_loss: decision.calculatedLoss,
          context,
        })
        .select("id")
        .single();
      latestRiskDecisionId = data?.id ?? null;
    },
  );
  const engine = new AutoTraderEngine(
    new CombinedOpportunityEngine(new MarketDataEngine(marketProvider)),
    risk,
    new TradePermissionService(system, riskSettings),
    guardedBroker,
    connectedBroker?.adapter === "ALPACA_PAPER"
      ? "ALPACA_PAPER"
      : connectedBroker
        ? "IBKR_PAPER"
        : "SIMULATED_PAPER",
    config,
    {
      claimOpportunity: async (key, opportunity) => {
        const { data, error } = await supabase
          .from("automated_decisions")
          .insert({
            user_id: userId,
            opportunity_key: key,
            symbol: asset.symbol,
            direction: opportunity.finalRecommendation,
            status: "PROCESSING",
            reason: "EVALUATING",
            signal_score: opportunity.combinedScore,
            strategies: opportunity.supportingStrategies,
            execution_source: "NONE",
          })
          .select("id")
          .single();
        if (error) return false;
        claimedDecisionId = data.id;
        const { data: storedOpportunity } = await supabase
          .from("strategy_opportunities")
          .insert({
            user_id: userId,
            symbol: opportunity.symbol,
            final_recommendation: opportunity.finalRecommendation,
            combined_score: opportunity.combinedScore,
            supporting_strategies: opportunity.supportingStrategies,
            conflicting_strategies: opportunity.conflictingStrategies,
            market_analysis: opportunity.marketAnalysis,
            data_source: opportunity.dataSource,
            evaluated_at: opportunity.timestamp,
          })
          .select("id")
          .single();
        await supabase.from("strategy_signals").insert(
          opportunity.signals.map((signal) => ({
            user_id: userId,
            strategy_name: signal.strategyName,
            symbol: signal.symbol,
            direction: signal.direction,
            score: signal.score,
            entry_suggestion: signal.entrySuggestion,
            stop_loss_suggestion: signal.stopLossSuggestion,
            take_profit_suggestion: signal.takeProfitSuggestion,
            risk_reward: signal.riskReward,
            reasoning: signal.reasoning,
            data_source: opportunity.dataSource,
            evaluated_at: signal.timestamp,
          })),
        );
        await supabase
          .from("automated_decisions")
          .update({ opportunity_id: storedOpportunity?.id })
          .eq("id", claimedDecisionId);
        return true;
      },
      buildRiskContext: async (
        order: BrokerOrderRequest,
      ): Promise<TradeRiskContext> => ({
        requestedCapital: Number(order.limitPrice) * order.quantity,
        expectedPrice: Number(order.limitPrice),
        stopLoss: order.stopLoss,
        dailyProfitLoss: Number(dailyResult.data?.profit_loss ?? 0),
        tradesToday: Number(dailyResult.data?.trades ?? 0),
        concurrentPositions: rows.length,
        portfolioExposure: exposure,
        autoTraderExposure: autoExposure,
        assetExposure: rows
          .filter((row) => row.symbol === asset.symbol)
          .reduce(
            (sum, row) =>
              sum +
              Number(row.quantity) *
                Number(row.current_price ?? row.entry_price),
            0,
          ),
        portfolioValue: Number(
          brokerDashboard.summary?.netLiquidation ?? 100000,
        ),
        portfolioDrawdownPct: Number(
          portfolioRiskResult.data?.drawdown_pct ?? 0,
        ),
        source: "AUTO_TRADER",
        emergencyStopActive: system.emergencyStopActive,
        systemLocked: system.riskState === "LOCKED",
        dailyLocked: ["LOCKED", "TARGET_REACHED"].includes(
          dailyResult.data?.status,
        ),
        dailyLockReason: dailyResult.data?.lock_reason,
      }),
      record: async (result) =>
        persistResult(
          supabase,
          userId,
          today,
          result,
          claimedDecisionId,
          latestRiskDecisionId,
        ),
    },
  );
  return NextResponse.json(await engine.run(asset));
}

async function persistResult(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  today: string,
  result: AutomatedDecisionResult,
  decisionId: string | null,
  riskDecisionId: string | null,
) {
  const values = {
    user_id: userId,
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
    risk_decision_id: riskDecisionId,
    completed_at: result.timestamp,
  };
  if (decisionId)
    await supabase
      .from("automated_decisions")
      .update(values)
      .eq("id", decisionId);
  else await supabase.from("automated_decisions").insert(values);
  if (decisionId && ["EXECUTED", "REDUCED"].includes(result.status)) {
    await supabase.from("orders").insert({
      user_id: userId,
      symbol: result.symbol,
      direction: result.direction,
      order_type: "LIMIT",
      quantity:
        result.entry && result.entry > 0 ? result.capital / result.entry : 0,
      status:
        result.executionSource === "SIMULATED_PAPER" ? "FILLED" : "SUBMITTED",
      mode: "PAPER",
      source: "AUTO_TRADER",
      client_order_id: result.opportunityKey,
      automated_decision_id: decisionId,
    });
    await supabase.from("automated_executions").insert({
      user_id: userId,
      automated_decision_id: decisionId,
      source: result.executionSource,
      broker_order_id: result.brokerOrderId,
      result,
    });
    if (
      result.executionSource === "SIMULATED_PAPER" &&
      result.entry &&
      result.stopLoss &&
      result.takeProfit
    )
      await supabase.from("positions").insert({
        user_id: userId,
        symbol: result.symbol,
        direction: result.direction,
        entry_price: result.entry,
        current_price: result.entry,
        quantity: result.capital / result.entry,
        stop_loss: result.stopLoss,
        take_profit: result.takeProfit,
        mode: "PAPER",
        source: "AUTO_TRADER",
        automated_decision_id: decisionId,
      });
    await supabase.rpc("record_auto_trader_execution", {
      p_user_id: userId,
      p_capital: result.capital,
    });
  }
  if (
    result.status === "LOCKED" &&
    result.reason !== "AUTO_TRADER_PAUSED_OR_LOCKED"
  )
    await supabase.from("auto_trader_daily_state").upsert(
      {
        user_id: userId,
        trading_date: today,
        status: result.reason.includes("PROFIT") ? "TARGET_REACHED" : "LOCKED",
        lock_reason: result.reason,
        updated_at: result.timestamp,
      },
      { onConflict: "user_id,trading_date" },
    );
  await supabase.from("journal_entries").insert({
    user_id: userId,
    automated_decision_id: decisionId,
    title: `${result.symbol} — ${result.direction} — ${result.status}`,
    body: `Strategy: ${result.strategies.join(" + ") || "None"}\nSignal strength: ${result.signalScore}/100 (not probability of profit)\nRisk decision: ${result.reason}\nCapital: ${result.capital}\nMaximum planned loss: ${result.maximumPlannedLoss}\nStop: ${result.stopLoss ?? "N/A"}\nTarget: ${result.takeProfit ?? "N/A"}\nExecution: ${result.executionSource}`,
    created_at: result.timestamp,
  });
}

async function upsertConfig(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  config: AutoTraderConfig,
) {
  const { data, error } = await supabase
    .from("auto_trader_config")
    .upsert(
      {
        user_id: userId,
        enabled: config.enabled,
        capital_allocation: config.capitalAllocation,
        maximum_trade_size: config.maximumTradeSize,
        maximum_risk_per_trade: config.maximumRiskPerTrade,
        daily_loss_limit: config.dailyLossLimit,
        daily_profit_target: config.dailyProfitTarget,
        maximum_trades_per_day: config.maximumTradesPerDay,
        maximum_concurrent_positions: config.maximumConcurrentPositions,
        minimum_strategy_score: config.minimumStrategyScore,
        allowed_strategies: config.allowedStrategies,
        allowed_assets: config.allowedAssets,
        risk_profile: config.riskProfile,
        maximum_portfolio_exposure: config.maximumPortfolioExposure,
        minimum_opportunity_score: config.minimumOpportunityScore,
        minimum_confidence: config.minimumConfidence,
        minimum_historical_score: config.minimumHistoricalScore,
        long_enabled: config.longEnabled,
        short_enabled: config.shortEnabled,
        session_start: config.sessionStart,
        session_end: config.sessionEnd,
        session_timezone: config.sessionTimezone,
        entry_start: config.entryStart,
        last_entry_time: config.lastEntryTime,
        force_exit_time: config.forceExitTime,
        maximum_hold_minutes: config.maximumHoldMinutes,
        minimum_exit_score: config.minimumExitScore,
        strategy_health_minimum_sample: config.strategyHealthMinimumSample,
        cooldown_minutes: config.cooldownMinutes,
        loss_cooldown_minutes: config.lossCooldownMinutes,
        paper_test_mode: config.paperTestMode,
        paper_test_target_auto_positions: config.paperTestTargetAutoPositions,
        paper_big_money_test_mode: config.paperBigMoneyTestMode,
        paper_test_target_big_money_positions:
          config.paperTestTargetBigMoneyPositions,
        paper_big_money_auto_approve_test: config.paperBigMoneyAutoApproveTest,
        paper_test_min_opportunity_score:
          config.paperTestMinimumOpportunityScore,
        paper_test_min_confidence: config.paperTestMinimumConfidence,
        paper_test_max_position_size: config.paperTestMaximumPositionSize,
        paper_test_max_risk_per_trade: config.paperTestMaximumRiskPerTrade,
        paper_test_max_daily_trades: config.paperTestMaximumDailyTrades,
        paper_test_universe: config.paperTestUniverse,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "CONFIG_WRITE_NOT_RETURNED");
  const persisted = mapConfig(data);
  const testFieldsMatch =
    persisted.paperTestMode === config.paperTestMode &&
    persisted.paperTestTargetAutoPositions ===
      config.paperTestTargetAutoPositions &&
    persisted.paperBigMoneyTestMode === config.paperBigMoneyTestMode &&
    persisted.paperTestTargetBigMoneyPositions ===
      config.paperTestTargetBigMoneyPositions &&
    persisted.paperBigMoneyAutoApproveTest ===
      config.paperBigMoneyAutoApproveTest &&
    persisted.paperTestMinimumOpportunityScore ===
      config.paperTestMinimumOpportunityScore &&
    persisted.paperTestMinimumConfidence ===
      config.paperTestMinimumConfidence &&
    persisted.paperTestMaximumPositionSize ===
      config.paperTestMaximumPositionSize &&
    persisted.paperTestMaximumRiskPerTrade ===
      config.paperTestMaximumRiskPerTrade &&
    persisted.paperTestMaximumDailyTrades ===
      config.paperTestMaximumDailyTrades &&
    JSON.stringify(persisted.paperTestUniverse) ===
      JSON.stringify(config.paperTestUniverse);
  if (!testFieldsMatch) throw new Error("CONFIG_WRITE_VERIFICATION_FAILED");
  return persisted;
}

function validConfig(config: AutoTraderConfig) {
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return (
    config.minimumStrategyScore >= 0 &&
    config.minimumStrategyScore <= 100 &&
    config.minimumOpportunityScore >= 0 &&
    config.minimumOpportunityScore <= 100 &&
    config.minimumConfidence >= 0 &&
    config.minimumConfidence <= 100 &&
    config.minimumHistoricalScore >= 0 &&
    config.minimumHistoricalScore <= 100 &&
    config.minimumExitScore >= 0 &&
    config.minimumExitScore <= 100 &&
    config.strategyHealthMinimumSample >= 5 &&
    config.strategyHealthMinimumSample <= 500 &&
    [
      config.sessionStart,
      config.entryStart,
      config.lastEntryTime,
      config.forceExitTime,
      config.sessionEnd,
    ].every(validTime) &&
    config.sessionStart <= config.entryStart &&
    config.entryStart < config.lastEntryTime &&
    config.lastEntryTime < config.forceExitTime &&
    config.forceExitTime < config.sessionEnd &&
    (config.maximumHoldMinutes == null ||
      (config.maximumHoldMinutes >= 5 && config.maximumHoldMinutes <= 1440)) &&
    config.allowedAssets.every((asset) => Boolean(assets[asset])) &&
    config.allowedStrategies.length > 0 &&
    config.paperTestTargetAutoPositions >= 1 &&
    config.paperTestTargetBigMoneyPositions >= 0 &&
    config.paperTestTargetBigMoneyPositions <=
      config.maximumConcurrentPositions &&
    config.paperTestMinimumOpportunityScore >= 0 &&
    config.paperTestMinimumOpportunityScore <= 100 &&
    config.paperTestMinimumConfidence >= 0 &&
    config.paperTestMinimumConfidence <= 100 &&
    config.paperTestMaximumPositionSize > 0 &&
    config.paperTestMaximumRiskPerTrade > 0 &&
    config.paperTestMaximumDailyTrades > 0 &&
    config.paperTestUniverse.length > 0 &&
    config.paperTestUniverse.every((asset) => Boolean(assets[asset])) &&
    [
      config.capitalAllocation,
      config.maximumTradeSize,
      config.maximumRiskPerTrade,
      config.dailyLossLimit,
      config.dailyProfitTarget,
      config.maximumTradesPerDay,
      config.maximumConcurrentPositions,
    ].every((value) => Number.isFinite(value) && value >= 0)
  );
}
