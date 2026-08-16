import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { strategyPerformance } from "@/src/services/paper-workflow";

export async function GET() {
  const user = await getAuthenticatedOwner();
  const db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [config, signals, trades, backtests] = await Promise.all([
    db
      .from("auto_trader_config")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("strategy_signals")
      .select("strategy_name,symbol,direction,score,reasoning,evaluated_at")
      .eq("user_id", user.id)
      .order("evaluated_at", { ascending: false })
      .limit(100),
    db
      .from("completed_paper_trades")
      .select("*")
      .eq("user_id", user.id)
      .order("exit_timestamp", { ascending: false })
      .limit(500),
    db
      .from("backtests")
      .select("id,strategy_name,status,metrics,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (config.error || signals.error || trades.error || backtests.error)
    return NextResponse.json(
      { error: "STRATEGY_PERFORMANCE_UNAVAILABLE" },
      { status: 503 },
    );
  return NextResponse.json({
    autoTrader: config.data,
    signals: signals.data ?? [],
    performance: strategyPerformance(trades.data ?? []),
    trades: trades.data ?? [],
    backtests: backtests.data ?? [],
  });
}
