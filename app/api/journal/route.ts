import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { journalSummary } from "@/src/services/paper-workflow";

export async function GET(request: Request) {
  const user = await getAuthenticatedOwner();
  const db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  let query = db
    .from("completed_paper_trades")
    .select("*")
    .eq("user_id", user.id)
    .order("exit_timestamp", { ascending: false })
    .limit(500);
  if (params.get("symbol"))
    query = query.eq("symbol", String(params.get("symbol")).toUpperCase());
  if (params.get("classification"))
    query = query.eq("classification", params.get("classification"));
  if (params.get("strategy"))
    query = query.eq("strategy_name", params.get("strategy"));
  if (params.get("origin"))
    query = query.eq("trade_origin", params.get("origin"));
  if (params.get("exitReason"))
    query = query.eq("exit_reason", params.get("exitReason"));
  if (params.get("from"))
    query = query.gte("exit_timestamp", params.get("from"));
  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: "JOURNAL_UNAVAILABLE" }, { status: 503 });
  const result = (data ?? []).filter((trade) => {
    if (params.get("result") === "WIN") return Number(trade.net_pl) > 0;
    if (params.get("result") === "LOSS") return Number(trade.net_pl) < 0;
    return true;
  });
  return NextResponse.json({ trades: result, summary: journalSummary(result) });
}
