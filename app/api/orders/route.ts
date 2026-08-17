import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const pending = new Set([
  "QUEUED",
  "PROCESSING",
  "SUBMITTING",
  "SUBMITTED",
  "ACCEPTED",
  "PARTIALLY_FILLED",
]);
const explanations: Record<string, string> = {
  REVIEW: "The order is waiting for owner confirmation.",
  QUEUED:
    "The order passed platform checks and is waiting for Railway to process it.",
  PROCESSING: "The Railway Trading Worker has claimed this order.",
  SUBMITTING: "The Railway Trading Worker has claimed this order.",
  SUBMITTED: "The worker sent the order to Alpaca PAPER.",
  ACCEPTED: "Alpaca PAPER accepted the order. It is waiting to fill.",
  PARTIALLY_FILLED: "Part of the order has filled.",
  FILLED: "The full order has filled.",
  POSITION_OPEN: "The filled order is now reflected as an open PAPER position.",
  CANCELED: "The order was canceled before completion.",
  REJECTED: "The broker or platform rejected the order.",
  FAILED: "The order failed safely before completion.",
  EXPIRED: "The order expired before completion.",
};

export async function GET(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await createSupabaseServerClient();
  if (!db)
    return NextResponse.json(
      { error: "Supabase unavailable" },
      { status: 503 },
    );
  const url = new URL(request.url),
    filter = (url.searchParams.get("filter") ?? "ALL").toUpperCase(),
    selectedId = url.searchParams.get("id");
  const [ordersResult, requestsResult, positionsResult, tradesResult] =
    await Promise.all([
      db
        .from("orders")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("paper_execution_requests")
        .select("*")
        .eq("user_id", user.id)
        .order("queued_at", { ascending: false })
        .limit(250),
      db
        .from("paper_positions")
        .select("id,entry_order_id,broker_order_id,status,symbol")
        .eq("user_id", user.id),
      db
        .from("completed_paper_trades")
        .select("id,entry_order_id,broker_order_id,symbol")
        .eq("user_id", user.id)
        .order("exit_timestamp", { ascending: false })
        .limit(250),
    ]);
  const requests = new Map(
    (requestsResult.data ?? []).map((row) => [row.order_id, row]),
  );
  const positions = new Map(
    (positionsResult.data ?? []).flatMap((row) =>
      row.entry_order_id ? [[row.entry_order_id, row]] : [],
    ),
  );
  const trades = new Map(
    (tradesResult.data ?? []).flatMap((row) =>
      row.entry_order_id ? [[row.entry_order_id, row]] : [],
    ),
  );
  const rows = (ordersResult.data ?? []).map((order) => {
    const execution = requests.get(order.id),
      position = positions.get(order.id),
      trade = trades.get(order.id);
    const rawState = String(
      execution?.status ?? order.status ?? "REVIEW",
    ).toUpperCase();
    const state =
      position?.status === "OPEN"
        ? "POSITION_OPEN"
        : rawState === "SUBMITTING"
          ? "PROCESSING"
          : rawState;
    const delayed =
      pending.has(rawState) &&
      !execution?.worker_received_at &&
      Date.now() - Date.parse(execution?.queued_at ?? order.created_at) >
        120_000;
    const classification =
      order.classification ??
      (order.source === "BIG_MONEY"
        ? "BIG"
        : order.source === "AUTO_TRADER"
          ? "SMALL"
          : order.source === "MANUAL"
            ? "MANUAL"
            : "STANDARD");
    return {
      id: order.id,
      clientOrderId: order.client_order_id,
      executionRequestId: execution?.id ?? null,
      symbol: order.symbol,
      side: order.direction,
      quantity: Number(order.quantity),
      orderType: order.order_type,
      limitPrice: order.limit_price == null ? null : Number(order.limit_price),
      source: order.source,
      classification,
      state,
      explanation:
        order.order_type === "LIMIT" &&
        ["ACCEPTED", "PARTIALLY_FILLED"].includes(rawState)
          ? "WAITING FOR LIMIT PRICE"
          : (explanations[state] ??
            "The persisted PAPER lifecycle is available for review."),
      createdAt: order.created_at,
      updatedAt: execution?.updated_at ?? order.updated_at ?? order.created_at,
      brokerOrderId:
        execution?.broker_order_id ?? order.broker_order_id ?? null,
      filledQuantity: Number(
        execution?.filled_quantity ?? order.filled_quantity ?? 0,
      ),
      averageFillPrice:
        execution?.average_fill_price == null
          ? order.average_fill_price == null
            ? null
            : Number(order.average_fill_price)
          : Number(execution.average_fill_price),
      errorReason: execution?.error_message ?? order.error_reason ?? null,
      workerDelayed: delayed,
      positionId: execution?.position_id ?? position?.id ?? null,
      completedTradeId: execution?.completed_trade_id ?? trade?.id ?? null,
      journalEntryId: execution?.journal_entry_id ?? null,
      timeline: [
        {
          key: "CREATED",
          label: "Created",
          at: order.created_at,
          complete: true,
        },
        {
          key: "RISK",
          label: "Risk Approved",
          at: execution?.queued_at ?? null,
          complete: Boolean(execution),
        },
        {
          key: "QUEUED",
          label: "Queued",
          at: execution?.queued_at ?? null,
          complete: Boolean(execution?.queued_at),
        },
        {
          key: "WORKER",
          label: "Railway Worker",
          at: execution?.worker_received_at ?? null,
          complete: Boolean(execution?.worker_received_at),
        },
        {
          key: "SUBMITTED",
          label: "Submitted to Alpaca",
          at: execution?.broker_submitted_at ?? null,
          complete: Boolean(execution?.broker_submitted_at),
        },
        {
          key: "ACCEPTED",
          label: "Alpaca Accepted",
          at: execution?.broker_acknowledged_at ?? null,
          complete: Boolean(execution?.broker_acknowledged_at),
        },
        {
          key: "FILLED",
          label: "Filled",
          at: execution?.filled_at ?? null,
          complete: Boolean(execution?.filled_at),
        },
        {
          key: "POSITION",
          label: "Position Open",
          at: position ? (execution?.filled_at ?? execution?.updated_at) : null,
          complete: position?.status === "OPEN",
        },
        {
          key: "CLOSED",
          label: "Closed",
          at: trade ? execution?.updated_at : null,
          complete: Boolean(trade),
        },
      ],
    };
  });
  const filtered = rows.filter((row) => {
    if (selectedId)
      return (
        row.id === selectedId ||
        row.executionRequestId === selectedId ||
        row.clientOrderId === selectedId
      );
    if (filter === "ALL") return true;
    if (filter === "PENDING")
      return pending.has(row.state) || row.state === "PROCESSING";
    if (filter === "OPEN") return row.state === "POSITION_OPEN";
    return row.state === filter;
  });
  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    pending: rows.filter(
      (row) => pending.has(row.state) || row.state === "PROCESSING",
    ).length,
    accepted: rows.filter((row) => row.state === "ACCEPTED").length,
    partiallyFilled: rows.filter((row) => row.state === "PARTIALLY_FILLED")
      .length,
    filledToday: rows.filter(
      (row) =>
        ["FILLED", "POSITION_OPEN"].includes(row.state) &&
        row.updatedAt?.startsWith(today),
    ).length,
    rejectedToday: rows.filter(
      (row) => row.state === "REJECTED" && row.updatedAt?.startsWith(today),
    ).length,
  };
  return NextResponse.json(
    {
      orders: filtered,
      summary,
      source: "SUPABASE_PAPER",
      refreshedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
