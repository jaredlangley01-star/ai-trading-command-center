import { NextResponse } from "next/server";
import type {
  Asset,
  BigMoneyRecommendation,
  RiskSettings,
  SystemState,
  TradeRiskContext,
} from "@/src/domain/models";
import { defaultRiskSettings } from "@/src/config/trading";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { createPaperBroker } from "@/src/services/broker/factory";
import { PaperOrderService } from "@/src/services/broker/paper-order-service";
import { createPaperMarketData } from "@/src/services/market-data/factory";
import { assertFreshMarketQuote } from "@/src/services/market-data/freshness";
import { MarketDataEngine } from "@/src/services/market-data-engine";
import { ResearchEngine } from "@/src/services/research-engine";
import { validateRecommendationForApproval } from "@/src/services/recommendation-safety";
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
      assetClass: "EQUITY",
      currency: "USD",
    },
  ]),
);

export async function GET() {
  const context = await ownerContext();
  if (context instanceof NextResponse) return context;
  const now = new Date().toISOString();
  const { data: expired } = await context.supabase
    .from("recommendations")
    .update({ status: "EXPIRED", updated_at: now })
    .eq("user_id", context.userId)
    .eq("status", "PENDING")
    .lt("expires_at", now)
    .select("id");
  if (expired?.length)
    await context.supabase.from("recommendation_events").insert(
      expired.map((item) => ({
        user_id: context.userId,
        recommendation_id: item.id,
        event_type: "EXPIRED",
      })),
    );
  const soon = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data: expiring } = await context.supabase
    .from("recommendations")
    .select("id")
    .eq("user_id", context.userId)
    .eq("status", "PENDING")
    .gt("expires_at", now)
    .lte("expires_at", soon);
  if (expiring?.length)
    await context.supabase.from("recommendation_events").upsert(
      expiring.map((item) => ({
        user_id: context.userId,
        recommendation_id: item.id,
        event_type: "EXPIRING_SOON",
      })),
      { onConflict: "recommendation_id,event_type", ignoreDuplicates: true },
    );
  const { data } = await context.supabase
    .from("recommendations")
    .select("*")
    .eq("user_id", context.userId)
    .order("research_score", { ascending: false })
    .limit(30);
  return NextResponse.json({ recommendations: data ?? [], mode: "PAPER" });
}

export async function POST(request: Request) {
  const context = await ownerContext();
  if (context instanceof NextResponse) return context;
  const body = (await request.json()) as {
    action?: "GENERATE" | "REFRESH" | "MODIFY" | "REJECT" | "APPROVE";
    symbol?: string;
    recommendationId?: string;
    paperConfirmed?: boolean;
    rejectionReason?: string;
    modifications?: Partial<BigMoneyRecommendation>;
  };
  if (body.action === "GENERATE" || body.action === "REFRESH")
    return generate(context.userId, context.supabase, body.symbol);
  if (!body.recommendationId)
    return NextResponse.json(
      { error: "Recommendation required." },
      { status: 400 },
    );
  if (body.action === "REJECT")
    return reject(
      context.userId,
      context.supabase,
      body.recommendationId,
      body.rejectionReason,
    );
  if (body.action === "MODIFY")
    return modify(
      context.userId,
      context.supabase,
      body.recommendationId,
      body.modifications ?? {},
    );
  if (body.action === "APPROVE")
    return approve(
      context.userId,
      context.supabase,
      body.recommendationId,
      body.paperConfirmed === true,
    );
  return NextResponse.json({ error: "Invalid action." }, { status: 400 });
}

async function generate(
  userId: string,
  supabase: Supabase,
  rawSymbol?: string,
) {
  const symbol = rawSymbol?.toUpperCase() ?? "";
  const asset = assets[symbol];
  if (!asset)
    return NextResponse.json({ error: "Unsupported asset." }, { status: 400 });
  try {
    const [opportunity, settingsResult, positionsResult] = await Promise.all([
      new CombinedOpportunityEngine(
        new MarketDataEngine(createPaperMarketData()),
      ).evaluate(asset),
      supabase
        .from("risk_settings")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("positions")
        .select("quantity,current_price,entry_price")
        .eq("user_id", userId),
    ]);
    const settings = {
      ...defaultRiskSettings,
      ...(settingsResult.data?.settings as Partial<RiskSettings> | undefined),
    };
    const exposure = (positionsResult.data ?? []).reduce(
      (sum, row) =>
        sum +
        Number(row.quantity) * Number(row.current_price ?? row.entry_price),
      0,
    );
    const recommendation = await new ResearchEngine().build(
      asset,
      opportunity,
      settings,
      exposure,
    );
    const { data: run } = await supabase
      .from("research_runs")
      .insert({
        user_id: userId,
        symbol,
        market_data_source: recommendation.dataSource,
        quote_timestamp: recommendation.quoteTimestamp,
        unavailable_dimensions: recommendation.unavailableResearch,
        inputs: {
          opportunity,
          portfolioExposure: exposure,
          riskSettings: settings,
        },
        output: recommendation,
      })
      .select("id")
      .single();
    const row = toRow(userId, recommendation, run?.id);
    const { data, error } = await supabase
      .from("recommendations")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    await Promise.all([
      supabase.from("recommendation_versions").insert({
        user_id: userId,
        recommendation_id: data.id,
        version: 1,
        values: recommendation,
        change_reason: "RESEARCH_GENERATED",
      }),
      supabase.from("recommendation_events").insert([
        {
          user_id: userId,
          recommendation_id: data.id,
          event_type: "NEW_RECOMMENDATION",
        },
        {
          user_id: userId,
          recommendation_id: data.id,
          event_type: "APPROVAL_REQUIRED",
        },
      ]),
    ]);
    return NextResponse.json({ recommendation: data, mode: "PAPER" });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Research failed safely.",
      },
      { status: 400 },
    );
  }
}

async function approve(
  userId: string,
  supabase: Supabase,
  id: string,
  confirmed: boolean,
) {
  if (!confirmed)
    return NextResponse.json(
      { error: "PAPER TRADE ONLY confirmation required." },
      { status: 400 },
    );
  const { data: rec } = await supabase
    .from("recommendations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!rec || rec.status !== "PENDING")
    return NextResponse.json(
      { error: "Recommendation is not pending." },
      { status: 409 },
    );
  if (!rec.expires_at || Date.parse(rec.expires_at) <= Date.now()) {
    await supabase
      .from("recommendations")
      .update({ status: "EXPIRED" })
      .eq("id", id);
    return NextResponse.json(
      { error: "RECOMMENDATION_EXPIRED" },
      { status: 410 },
    );
  }
  try {
    const selected = createPaperBroker();
    if (!selected) throw new Error("CLOUD_PAPER_BROKER_DISCONNECTED");
    const asset = assets[String(rec.symbol).toUpperCase()];
    const quote = await createPaperMarketData().getQuote(asset);
    const freshness = assertFreshMarketQuote(quote);
    let priceChange = 0;
    try {
      priceChange = validateRecommendationForApproval({
        status: rec.status,
        expiresAt: rec.expires_at,
        referencePrice: Number(rec.current_price),
        currentPrice: quote.last,
        paperConfirmed: confirmed,
      }).priceChangePct;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "MARKET_CONDITIONS_CHANGED_REFRESH_REQUIRED"
      )
        throw error;
      await supabase.from("recommendation_events").insert({
        user_id: userId,
        recommendation_id: id,
        event_type: "BLOCKED_MARKET_CHANGE",
        payload: {
          previous: rec.current_price,
          current: quote.last,
          priceChange,
        },
      });
      return NextResponse.json(
        { error: "MARKET_CONDITIONS_CHANGED_REFRESH_REQUIRED" },
        { status: 409 },
      );
    }
    const [
      systemResult,
      settingsResult,
      positionsResult,
      dailyResult,
      summary,
    ] = await Promise.all([
      supabase
        .from("system_state")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("risk_settings")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("positions")
        .select("symbol,quantity,current_price,entry_price,source")
        .eq("user_id", userId),
      supabase
        .from("daily_risk_state")
        .select("*")
        .eq("user_id", userId)
        .eq("trading_date", new Date().toISOString().slice(0, 10))
        .maybeSingle(),
      selected.broker.getAccountSummary(),
    ]);
    const settings = {
      ...defaultRiskSettings,
      ...(settingsResult.data?.settings as Partial<RiskSettings> | undefined),
    };
    const state: SystemState = {
      mode: "PAPER",
      autoTraderStatus: systemResult.data?.auto_trader_status ?? "PAUSED",
      riskState: systemResult.data?.risk_state ?? "NORMAL",
      emergencyStopActive: systemResult.data?.emergency_stop_active ?? false,
    };
    const rows = positionsResult.data ?? [];
    const exposure = (filter?: (row: Record<string, unknown>) => boolean) =>
      rows
        .filter((row) => !filter || filter(row))
        .reduce(
          (sum, row) =>
            sum +
            Number(row.quantity) * Number(row.current_price ?? row.entry_price),
          0,
        );
    const capital = Number(rec.investment);
    const riskContext: TradeRiskContext = {
      requestedCapital: capital,
      expectedPrice: quote.last,
      stopLoss: Number(rec.stop_loss),
      dailyProfitLoss: Number(dailyResult.data?.profit_loss ?? 0),
      tradesToday: Number(dailyResult.data?.trades_opened ?? 0),
      concurrentPositions: rows.length,
      portfolioExposure: exposure(),
      autoTraderExposure: exposure((row) => row.source === "AUTO_TRADER"),
      assetExposure: exposure((row) => row.symbol === rec.symbol),
      portfolioValue: Number(summary.netLiquidation ?? summary.balance ?? 0),
      portfolioDrawdownPct: 0,
      source: "BIG_MONEY",
      recommendationScore: Number(rec.research_score),
      emergencyStopActive: state.emergencyStopActive,
      systemLocked: state.riskState === "LOCKED",
    };
    const result = await new PaperOrderService(
      selected.broker,
      new ProductionRiskManager(settings),
      new TradePermissionService(state, settings),
    ).submit(
      {
        symbol: rec.symbol,
        direction: rec.direction,
        quantity: Math.max(1, Math.floor(capital / quote.last)),
        type: "LIMIT",
        limitPrice: quote.last,
        stopLoss: Number(rec.stop_loss),
        source: "BIG_MONEY",
        mode: "PAPER",
        confirmed: true,
        clientOrderId: `big-money:${id}:${rec.version}`,
      },
      riskContext,
    );
    const timestamp = new Date().toISOString();
    await Promise.all([
      supabase
        .from("recommendations")
        .update({
          status: "APPROVED",
          approval_timestamp: timestamp,
          updated_at: timestamp,
        })
        .eq("id", id),
      supabase.from("orders").insert({
        user_id: userId,
        recommendation_id: id,
        symbol: rec.symbol,
        direction: rec.direction,
        order_type: "LIMIT",
        quantity: Math.max(1, Math.floor(capital / quote.last)),
        status: result.status,
        mode: "PAPER",
        source: "BIG_MONEY",
        client_order_id: `big-money:${id}:${rec.version}`,
      }),
      supabase.from("audit_events").insert({
        user_id: userId,
        action: "RECOMMENDATION_APPROVED",
        metadata: {
          recommendation_id: id,
          mode: "PAPER",
          quote_timestamp: freshness.timestamp,
          provider: quote.provider,
          broker_order_id: result.brokerOrderId,
        },
      }),
    ]);
    return NextResponse.json({
      status: "APPROVED",
      order: result,
      mode: "PAPER",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "APPROVAL_BLOCKED" },
      { status: 423 },
    );
  }
}

async function reject(
  userId: string,
  supabase: Supabase,
  id: string,
  reason?: string,
) {
  const timestamp = new Date().toISOString();
  const { data } = await supabase
    .from("recommendations")
    .update({
      status: "REJECTED",
      rejection_reason: reason ?? "OWNER_REJECTED",
      updated_at: timestamp,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();
  if (!data)
    return NextResponse.json(
      { error: "Recommendation is not pending." },
      { status: 409 },
    );
  await supabase.from("audit_events").insert({
    user_id: userId,
    action: "RECOMMENDATION_REJECTED",
    metadata: { recommendation_id: id, reason },
  });
  return NextResponse.json({ status: "REJECTED" });
}

async function modify(
  userId: string,
  supabase: Supabase,
  id: string,
  changes: Partial<BigMoneyRecommendation>,
) {
  const allowed = {
    investment: changes.recommendedCapital,
    stop_loss: changes.recommendedStopLoss,
    take_profit: changes.recommendedTakeProfit,
    selected_risk_profile: changes.selectedRiskProfile,
  };
  if (
    [allowed.investment, allowed.stop_loss, allowed.take_profit].some(
      (value) =>
        value !== undefined && (!Number.isFinite(value) || Number(value) <= 0),
    )
  )
    return NextResponse.json(
      { error: "Invalid owner modifications." },
      { status: 400 },
    );
  const { data: rec } = await supabase
    .from("recommendations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "PENDING")
    .maybeSingle();
  if (!rec)
    return NextResponse.json(
      { error: "Recommendation is not pending." },
      { status: 409 },
    );
  const version = Number(rec.version) + 1;
  const values = {
    ...rec,
    ...allowed,
    version,
    owner_modifications: changes,
    updated_at: new Date().toISOString(),
  };
  await Promise.all([
    supabase.from("recommendations").update(values).eq("id", id),
    supabase.from("recommendation_versions").insert({
      user_id: userId,
      recommendation_id: id,
      version,
      values,
      change_reason: "OWNER_MODIFIED",
    }),
  ]);
  return NextResponse.json({ recommendation: values, mode: "PAPER" });
}

const toRow = (
  userId: string,
  item: BigMoneyRecommendation,
  researchRunId?: string,
) => ({
  user_id: userId,
  research_run_id: researchRunId,
  symbol: item.symbol,
  direction: item.direction,
  score: item.strategyScore,
  research_score: item.researchScore,
  investment: item.recommendedCapital,
  stop_loss: item.recommendedStopLoss,
  take_profit: item.recommendedTakeProfit,
  current_price: item.currentPrice,
  maximum_planned_loss: item.maximumPlannedLoss,
  risk_reward: item.riskReward,
  market_condition: item.marketCondition,
  data_source: item.dataSource,
  quote_timestamp: item.quoteTimestamp,
  expires_at: item.expiresAt,
  selected_risk_profile: item.selectedRiskProfile,
  risk_profiles: item.riskProfiles,
  status: "PENDING",
  analysis: item,
});

async function ownerContext() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  return { userId: user.id, supabase };
}
type Supabase = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;
