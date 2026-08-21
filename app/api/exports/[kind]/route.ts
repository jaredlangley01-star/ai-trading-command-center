import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { toCsv } from "@/src/services/csv-export";
import { livePaperStrategyPerformance } from "@/src/services/strategy-analytics";

export const dynamic = "force-dynamic";
const journalColumns = [
  ["id", "trade ID"],
  ["symbol", "symbol"],
  ["classification", "trade type"],
  ["trade_origin", "origin"],
  ["strategy_name", "strategy"],
  ["direction", "direction"],
  ["quantity", "quantity"],
  ["entry_timestamp", "entry timestamp"],
  ["entry_price", "entry price"],
  ["exit_timestamp", "exit timestamp"],
  ["exit_price", "exit price"],
  ["stop_loss", "stop"],
  ["take_profit", "target"],
  ["gross_pl", "gross P/L"],
  ["net_pl", "net P/L"],
  ["return_pct", "return %"],
  ["costs", "fees/slippage"],
  ["duration_minutes", "duration minutes"],
  ["entry_reason", "entry reason"],
  ["exit_reason", "exit reason"],
  ["risk_decision", "risk amount/decision"],
  ["opportunity_score", "opportunity score"],
  ["broker_order_id", "broker order ID"],
  ["environment", "environment"],
  ["paper_test_mode", "test-mode flag"],
  ["test_slot", "test slot"],
] as const;
const columns = (values: readonly (readonly [string, string])[]) =>
  values.map(([key, label]) => ({ key, label }));

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const user = await getAuthenticatedOwner();
  const db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { kind } = await context.params;
  let rows: Array<Record<string, unknown>> = [];
  let exportColumns: Array<{ key: string; label: string }> = [];
  if (kind === "journal") {
    const result = await db
      .from("completed_paper_trades")
      .select(
        "id,symbol,classification,trade_origin,strategy_name,direction,quantity,entry_timestamp,entry_price,exit_timestamp,exit_price,stop_loss,take_profit,gross_pl,net_pl,return_pct,costs,entry_reason,exit_reason,risk_decision,broker_order_id,environment,paper_test_mode,test_slot,metadata",
      )
      .eq("user_id", user.id)
      .order("exit_timestamp", { ascending: false })
      .limit(5000);
    rows = (result.data ?? []).map((row) => ({
      ...row,
      duration_minutes: Math.max(
        0,
        Math.round(
          (Date.parse(row.exit_timestamp) - Date.parse(row.entry_timestamp)) /
            60_000,
        ),
      ),
      opportunity_score: row.metadata?.opportunity_score ?? "",
    }));
    exportColumns = columns(journalColumns);
  } else if (kind === "orders") {
    const result = await db
      .from("paper_execution_requests")
      .select(
        "id,broker_order_id,symbol,direction,quantity,order_type,status,broker_submitted_at,broker_acknowledged_at,filled_at,error_message,source,queued_at,updated_at,paper_test_mode,test_slot,candidate_rank,selection_reason,test_thresholds",
      )
      .eq("user_id", user.id)
      .order("queued_at", { ascending: false })
      .limit(5000);
    rows = result.data ?? [];
    exportColumns = columns([
      ["id", "request ID"],
      ["broker_order_id", "broker order ID"],
      ["symbol", "symbol"],
      ["direction", "side"],
      ["quantity", "quantity"],
      ["order_type", "order type"],
      ["status", "status"],
      ["broker_submitted_at", "submitted"],
      ["broker_acknowledged_at", "accepted"],
      ["filled_at", "filled"],
      ["error_message", "rejected/canceled reason"],
      ["source", "origin"],
      ["queued_at", "queued timestamp"],
      ["updated_at", "updated timestamp"],
      ["paper_test_mode", "test-mode flag"],
      ["test_slot", "slot number"],
      ["candidate_rank", "candidate ranking"],
      ["selection_reason", "why selected/rejected"],
      ["test_thresholds", "test thresholds used"],
    ]);
  } else if (kind === "fills") {
    const result = await db
      .from("paper_broker_fills")
      .select(
        "broker_execution_id,broker_order_id,symbol,side,quantity,price,trade_origin,strategy_name,executed_at,paper_test_mode,test_slot",
      )
      .eq("user_id", user.id)
      .order("executed_at", { ascending: false })
      .limit(5000);
    rows = result.data ?? [];
    exportColumns = columns([
      ["broker_execution_id", "fill ID"],
      ["broker_order_id", "broker order ID"],
      ["symbol", "symbol"],
      ["side", "side"],
      ["quantity", "quantity"],
      ["price", "price"],
      ["trade_origin", "origin"],
      ["strategy_name", "strategy"],
      ["executed_at", "executed timestamp"],
      ["paper_test_mode", "test-mode flag"],
      ["test_slot", "slot number"],
    ]);
  } else if (kind === "strategies") {
    const [trades, config] = await Promise.all([
      db
        .from("completed_paper_trades")
        .select("*")
        .eq("user_id", user.id)
        .eq("trade_origin", "AUTO_TRADER")
        .eq("environment", "PAPER")
        .limit(5000),
      db
        .from("auto_trader_config")
        .select("strategy_health_minimum_sample")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    const performance = livePaperStrategyPerformance(
      trades.data ?? [],
      Number(config.data?.strategy_health_minimum_sample ?? 20),
    );
    rows = Object.entries(performance).map(([strategy, metrics]) => ({
      strategy,
      ...metrics,
    }));
    exportColumns = columns([
      ["strategy", "strategy"],
      ["completed", "completed trades"],
      ["wins", "wins"],
      ["losses", "losses"],
      ["winRate", "win rate"],
      ["totalRealizedPl", "P/L"],
      ["averageWin", "average win"],
      ["averageLoss", "average loss"],
      ["profitFactor", "profit factor"],
      ["expectancy", "expectancy"],
      ["maxDrawdown", "drawdown"],
      ["health", "health classification"],
    ]);
  } else if (kind === "backtests") {
    const result = await db
      .from("backtests")
      .select(
        "id,strategy_name,status,data_source,data_timeframe,period_start,period_end,metrics,created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1000);
    rows = result.data ?? [];
    exportColumns = columns([
      ["id", "backtest ID"],
      ["strategy_name", "strategy"],
      ["status", "status"],
      ["data_source", "data source"],
      ["data_timeframe", "timeframe"],
      ["period_start", "period start"],
      ["period_end", "period end"],
      ["metrics", "metrics"],
      ["created_at", "created timestamp"],
    ]);
  } else return NextResponse.json({ error: "UNKNOWN_EXPORT" }, { status: 404 });
  return new NextResponse(toCsv(exportColumns, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trade-${kind}-paper.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
