import { NextResponse } from "next/server";
import type { Asset, CombinedOpportunity } from "@/src/domain/models";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { MarketDataEngine } from "@/src/services/market-data-engine";
import { createPaperMarketData } from "@/src/services/market-data/factory";
import {
  CombinedOpportunityEngine,
  defaultStrategies,
} from "@/src/services/strategies/combined-opportunity-engine";

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

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json({
      strategies: [],
      signals: [],
      opportunities: [],
    });
  const [strategies, signals, opportunities] = await Promise.all([
    supabase
      .from("strategies")
      .select("id,name,version,enabled,parameters")
      .eq("user_id", user.id)
      .order("name"),
    supabase
      .from("strategy_signals")
      .select("*")
      .eq("user_id", user.id)
      .order("evaluated_at", { ascending: false })
      .limit(24),
    supabase
      .from("strategy_opportunities")
      .select("*")
      .eq("user_id", user.id)
      .order("combined_score", { ascending: false })
      .limit(12),
  ]);
  return NextResponse.json({
    strategies: strategies.data ?? [],
    signals: signals.data ?? [],
    opportunities: opportunities.data ?? [],
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { symbol?: string };
  const symbol = body.symbol?.trim().toUpperCase() ?? "";
  const asset = assets[symbol];
  if (!asset)
    return NextResponse.json(
      { error: "Unsupported monitored symbol." },
      { status: 400 },
    );
  const result = await new CombinedOpportunityEngine(
    new MarketDataEngine(createPaperMarketData()),
  ).evaluate(asset);
  const supabase = await createSupabaseServerClient();
  if (supabase) await persistEvaluation(user.id, result, supabase);
  return NextResponse.json(result);
}

async function persistEvaluation(
  userId: string,
  result: CombinedOpportunity,
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
) {
  const strategies = defaultStrategies();
  await supabase.from("strategies").upsert(
    strategies.map((strategy) => ({
      user_id: userId,
      name: strategy.name,
      version: "1.0.0",
      enabled: true,
      parameters: { mode: "PAPER", scoreMeaning: "normalized signal strength" },
    })),
    { onConflict: "user_id,name" },
  );
  await supabase.from("strategy_signals").insert(
    result.signals.map((signal) => ({
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
      data_source: result.dataSource,
      evaluated_at: signal.timestamp,
    })),
  );
  await supabase.from("strategy_opportunities").insert({
    user_id: userId,
    symbol: result.symbol,
    final_recommendation: result.finalRecommendation,
    combined_score: result.combinedScore,
    supporting_strategies: result.supportingStrategies,
    conflicting_strategies: result.conflictingStrategies,
    market_analysis: result.marketAnalysis,
    data_source: result.dataSource,
    evaluated_at: result.timestamp,
  });
  await supabase.from("strategy_evaluations").insert({
    user_id: userId,
    symbol: result.symbol,
    strategy_count: result.signals.length,
    result,
    evaluated_at: result.timestamp,
  });
}
