import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json({
      source: "DEMO",
      account: null,
      positions: [],
      fills: [],
    });
  const [account, positions, fills, history] = await Promise.all([
    supabase
      .from("paper_portfolio_current")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("paper_positions")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["OPEN", "EXIT_PENDING"])
      .order("symbol"),
    supabase
      .from("paper_broker_fills")
      .select("*")
      .eq("user_id", user.id)
      .order("executed_at", { ascending: false })
      .limit(10),
    supabase
      .from("paper_portfolio_pl_history")
      .select("equity,realized_pl,unrealized_pl,open_exposure,sampled_at")
      .eq("user_id", user.id)
      .order("sampled_at", { ascending: false })
      .limit(120),
  ]);
  if (account.error || positions.error || fills.error || history.error)
    return NextResponse.json(
      { error: "PORTFOLIO_SYNC_UNAVAILABLE" },
      { status: 503 },
    );
  return NextResponse.json({
    source: account.data ? "ALPACA_PAPER" : "DEMO",
    account: account.data,
    positions: positions.data ?? [],
    fills: fills.data ?? [],
    history: (history.data ?? []).reverse(),
  });
}
