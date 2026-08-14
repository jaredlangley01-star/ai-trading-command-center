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

const assets: Record<string, Asset> = Object.fromEntries(
  ["AAPL", "NVDA", "MSFT", "AMZN"].map((symbol) => [
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
  const [config, daily, decisions, system] = await Promise.all([
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
      .select("auto_trader_status,emergency_stop_active")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  return NextResponse.json({
    config: mapConfig(config.data),
    daily: daily.data,
    decisions: decisions.data ?? [],
    systemStatus: system.data?.emergency_stop_active
      ? "LOCKED"
      : (system.data?.auto_trader_status ?? "PAUSED"),
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
    await upsertConfig(supabase, user.id, body.config);
    return NextResponse.json({ config: body.config, mode: "PAPER" });
  }
  if (body.action === "PAUSE" || body.action === "RESUME") {
    const { data: system } = await supabase
      .from("system_state")
      .select("emergency_stop_active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (body.action === "RESUME" && system?.emergency_stop_active)
      return NextResponse.json(
        { error: "Emergency Stop is active." },
        { status: 423 },
      );
    await supabase
      .from("auto_trader_config")
      .upsert(
        { user_id: user.id, enabled: body.action === "RESUME" },
        { onConflict: "user_id" },
      );
    await supabase.from("system_state").upsert(
      {
        user_id: user.id,
        mode: "PAPER",
        auto_trader_status: body.action === "RESUME" ? "ACTIVE" : "PAUSED",
      },
      { onConflict: "user_id" },
    );
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
  const config = mapConfig(configResult.data);
  const system: SystemState = {
    mode: "PAPER",
    autoTraderStatus: systemResult.data?.auto_trader_status ?? "PAUSED",
    riskState: systemResult.data?.risk_state ?? "NORMAL",
    emergencyStopActive: systemResult.data?.emergency_stop_active ?? false,
  };
  const selected = createPaperBroker();
  const connectedBroker = brokerDashboard.source !== "DEMO" ? selected : null;
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
  await supabase.from("auto_trader_config").upsert(
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
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

function validConfig(config: AutoTraderConfig) {
  return (
    config.minimumStrategyScore >= 0 &&
    config.minimumStrategyScore <= 100 &&
    config.allowedAssets.every((asset) => Boolean(assets[asset])) &&
    config.allowedStrategies.length > 0 &&
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
