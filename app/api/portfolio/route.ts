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
      source: "NO_SYNC_DATA",
      account: null,
      positions: [],
      fills: [],
    });
  const [
    account,
    positions,
    orders,
    reconciliation,
    fills,
    history,
    journal,
    activity,
  ] = await Promise.all([
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
      .from("orders")
      .select(
        "id,symbol,direction,order_type,quantity,status,source,client_order_id,created_at",
      )
      .eq("user_id", user.id)
      .in("status", [
        "DRAFT",
        "NEW",
        "ACCEPTED",
        "SUBMITTED",
        "PARTIALLY_FILLED",
      ])
      .order("created_at", { ascending: false }),
    supabase
      .from("broker_reconciliation_runs")
      .select("orders,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
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
    supabase
      .from("completed_paper_trades")
      .select("*")
      .eq("user_id", user.id)
      .order("exit_timestamp", { ascending: false })
      .limit(100),
    supabase
      .from("audit_events")
      .select("id,action,metadata,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (
    account.error ||
    positions.error ||
    orders.error ||
    reconciliation.error ||
    fills.error ||
    history.error ||
    journal.error ||
    activity.error
  )
    return NextResponse.json(
      { error: "PORTFOLIO_SYNC_UNAVAILABLE" },
      { status: 503 },
    );
  return NextResponse.json({
    source: account.data ? "ALPACA_PAPER" : "NO_SYNC_DATA",
    account: account.data,
    positions: positions.data ?? [],
    orders: Array.isArray(reconciliation.data?.orders)
      ? reconciliation.data.orders.map((brokerOrder) => {
          const raw = brokerOrder as Record<string, unknown>;
          const platform = (orders.data ?? []).find(
            (order) => order.client_order_id === raw.client_order_id,
          );
          return {
            id: String(raw.id ?? platform?.id ?? ""),
            symbol: String(raw.symbol ?? platform?.symbol ?? ""),
            direction: String(raw.side ?? platform?.direction ?? ""),
            order_type: String(raw.type ?? platform?.order_type ?? ""),
            quantity: Number(raw.qty ?? platform?.quantity ?? 0),
            status: String(raw.status ?? platform?.status ?? ""),
            source: platform?.source ?? "STANDARD",
            client_order_id: String(
              raw.client_order_id ?? platform?.client_order_id ?? "",
            ),
            created_at: String(
              raw.created_at ??
                platform?.created_at ??
                reconciliation.data?.created_at ??
                new Date().toISOString(),
            ),
          };
        })
      : (orders.data ?? []),
    fills: fills.data ?? [],
    history: (history.data ?? []).reverse(),
    journal: journal.data ?? [],
    activity: activity.data ?? [],
  });
}
