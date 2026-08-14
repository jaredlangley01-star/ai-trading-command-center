import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import type { BacktestConfig } from "@/src/services/backtesting/engine";

const strategies = [
  "Momentum",
  "Breakout",
  "Trend Following",
  "Mean Reversion",
  "Combined Opportunity",
];
const timeframes = ["1Min", "5Min", "15Min", "1Hour", "1Day"];

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ runs: [] });
  const { data, error } = await supabase
    .from("backtests")
    .select("*,backtest_trades(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(25);
  return error
    ? NextResponse.json({ error: "BACKTEST_READ_FAILED" }, { status: 503 })
    : NextResponse.json({ runs: data ?? [] });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = (await request.json()) as BacktestConfig;
  if (
    !strategies.includes(config.strategy) ||
    !timeframes.includes(config.timeframe) ||
    !/^[A-Z.]{1,10}$/.test(config.symbol?.toUpperCase() ?? "") ||
    !Number.isFinite(config.startingCapital) ||
    config.startingCapital <= 0 ||
    !Number.isFinite(config.positionSizePct) ||
    config.positionSizePct <= 0 ||
    config.positionSizePct > 100 ||
    !Number.isFinite(config.stopLossPct) ||
    config.stopLossPct <= 0 ||
    !Number.isFinite(config.takeProfitPct) ||
    config.takeProfitPct <= 0 ||
    !Number.isInteger(config.maximumConcurrentPositions) ||
    config.maximumConcurrentPositions < 1 ||
    config.maximumConcurrentPositions > 10 ||
    !Number.isFinite(config.slippageBps) ||
    config.slippageBps < 0 ||
    !Number.isFinite(config.commissionPerTrade) ||
    config.commissionPerTrade < 0 ||
    Date.parse(config.start) >= Date.parse(config.end)
  )
    return NextResponse.json(
      { error: "INVALID_BACKTEST_CONFIGURATION" },
      { status: 400 },
    );
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json({ error: "SUPABASE_REQUIRED" }, { status: 503 });
  const jobKey = crypto.randomUUID();
  const { data, error } = await supabase
    .from("backtests")
    .insert({
      user_id: user.id,
      job_key: jobKey,
      status: "QUEUED",
      configuration: { ...config, symbol: config.symbol.toUpperCase() },
      strategy_name: config.strategy,
      strategy_version: "TRADE-012",
      data_source: "ALPACA_IEX_HISTORICAL",
      data_timeframe: config.timeframe,
      period_start: new Date(config.start).toISOString(),
      period_end: new Date(config.end).toISOString(),
      assumptions: {
        slippageBps: config.slippageBps,
        commissionPerTrade: config.commissionPerTrade,
        signalTiming: "CANDLE_CLOSE_ENTRY_NEXT_OPEN",
      },
      metrics: {},
    })
    .select("id,status")
    .single();
  return error
    ? NextResponse.json({ error: "BACKTEST_QUEUE_FAILED" }, { status: 409 })
    : NextResponse.json(data, { status: 202 });
}
