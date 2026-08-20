import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/src/lib/supabase/server";
import { OpenAIResponsesResearchProvider } from "@/src/services/intelligence/ai-provider";
import { livePaperStrategyPerformance } from "@/src/services/strategy-analytics";

export const dynamic = "force-dynamic";

async function ownerContext(userId: string) {
  const db = await createSupabaseServerClient();
  if (!db) return null;
  const [
    portfolio,
    positions,
    orders,
    recommendations,
    risk,
    auto,
    diagnostics,
    trades,
    notifications,
    market,
    intelligence,
    backtests,
  ] = await Promise.all([
    db
      .from("paper_portfolio_current")
      .select("equity,cash,buying_power,realized_pl_today,unrealized_pl,as_of")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("paper_positions")
      .select(
        "id,symbol,trade_origin,strategy_name,quantity,current_price,unrealized_pl,stop_loss,take_profit,protection_status,status",
      )
      .eq("user_id", userId)
      .in("status", ["OPEN", "EXIT_PENDING"]),
    db
      .from("paper_execution_requests")
      .select("id,symbol,status,source,queued_at")
      .eq("user_id", userId)
      .order("queued_at", { ascending: false })
      .limit(20),
    db
      .from("recommendations")
      .select("id,symbol,direction,status,score,created_at")
      .eq("user_id", userId)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("system_state")
      .select("mode,risk_state,emergency_stop_active,auto_trader_status")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("auto_trader_config")
      .select(
        "enabled,entry_start,last_entry_time,force_exit_time,session_timezone,strategy_health_minimum_sample,paper_test_mode,paper_test_target_auto_positions,paper_big_money_test_mode,paper_test_target_big_money_positions",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("trading_worker_heartbeats")
      .select("status,last_seen_at,metadata")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("completed_paper_trades")
      .select("*")
      .eq("user_id", userId)
      .eq("trade_origin", "AUTO_TRADER")
      .eq("environment", "PAPER")
      .order("exit_timestamp", { ascending: false })
      .limit(500),
    db
      .from("notification_events")
      .select("id,event_type,severity,title,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("paper_market_quotes")
      .select("symbol,last,bid,ask,as_of,market_session,provider,feed")
      .eq("user_id", userId)
      .order("as_of", { ascending: false })
      .limit(30),
    db
      .from("intelligence_snapshots")
      .select(
        "symbol,direction,opportunity_score,confidence,generated_at,freshness",
      )
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(20),
    db
      .from("backtests")
      .select("id,strategy_name,status,metrics,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    environment: "PAPER",
    liveLocked: true,
    portfolio: portfolio.data,
    positions: positions.data ?? [],
    orders: orders.data ?? [],
    recommendations: recommendations.data ?? [],
    risk: risk.data,
    autoTrader: auto.data,
    diagnostics: diagnostics.data,
    strategyPerformance: livePaperStrategyPerformance(
      trades.data ?? [],
      Number(auto.data?.strategy_health_minimum_sample ?? 20),
    ),
    notifications: notifications.data ?? [],
    market: market.data ?? [],
    intelligence: intelligence.data ?? [],
    backtests: backtests.data ?? [],
  };
}

function deterministicReply(
  question: string,
  context: NonNullable<Awaited<ReturnType<typeof ownerContext>>>,
) {
  const text = question.toLowerCase();
  const dayTrades = context.positions.filter(
    (position) => position.trade_origin === "AUTO_TRADER",
  );
  const bigMoney = context.positions.filter(
    (position) => position.trade_origin === "BIG_MONEY",
  );
  if (text.includes("big money") || text.includes("opportun"))
    return context.recommendations.length
      ? `${context.recommendations.length} Big Money recommendation${context.recommendations.length === 1 ? " is" : "s are"} awaiting review. Approval remains available only in the Big Money workflow.`
      : "There are no persisted Big Money recommendations awaiting review.";
  if (text.includes("market") || text.includes("watch"))
    return context.market.length
      ? context.market
          .slice(0, 5)
          .map(
            (quote) =>
              `${quote.symbol} ${Number(quote.last).toFixed(2)} (${String(quote.market_session).replaceAll("_", " ")}, ${quote.provider} ${quote.feed}, ${quote.as_of}).`,
          )
          .join(" ")
      : "No current persisted market quotes are available. I will not invent market conditions.";
  if (text.includes("los") || text.includes("p/l") || text.includes("profit"))
    return `The synchronized PAPER portfolio reports unrealized P/L of ${Number(context.portfolio?.unrealized_pl ?? 0).toFixed(2)} and today's realized P/L of ${Number(context.portfolio?.realized_pl_today ?? 0).toFixed(2)}. ${context.positions.length} positions are currently open.`;
  if (text.includes("risk") || text.includes("emergency"))
    return `Risk Manager state is ${context.risk?.risk_state ?? "UNAVAILABLE"}. Emergency Stop is ${context.risk?.emergency_stop_active ? "ACTIVE" : "not active"}. LIVE remains locked.`;
  if (text.includes("strateg")) {
    const entries = Object.entries(context.strategyPerformance);
    return entries.length
      ? entries
          .map(
            ([name, metrics]) =>
              `${name}: ${metrics.completed} PAPER trades, net P/L ${metrics.totalRealizedPl.toFixed(2)}, ${metrics.health}.`,
          )
          .join(" ")
      : "There are not yet enough completed Auto Trader PAPER trades to report strategy performance.";
  }
  return `Auto Trader is ${context.risk?.auto_trader_status ?? "UNAVAILABLE"} with ${dayTrades.length} active day trades. Big Money has ${bigMoney.length} active multi-day positions. The Trading Worker is ${context.diagnostics?.status ?? "UNAVAILABLE"}. All figures are from persisted PAPER state.`;
}

const actions = [
  { label: "OPEN PORTFOLIO", href: "/?section=Portfolio" },
  {
    label: "REVIEW BIG MONEY OPPORTUNITY",
    href: "/?section=Big%20Money",
  },
  { label: "VIEW STRATEGIES", href: "/?section=Strategies" },
  { label: "RUN BACKTEST", href: "/?section=Backtesting" },
  { label: "OPEN DIAGNOSTICS", href: "/?section=Diagnostics" },
];

export async function GET() {
  const user = await getAuthenticatedOwner();
  const db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [messages, proposals, context] = await Promise.all([
    db
      .from("trader_messages")
      .select("id,role,content,actions,proactive,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(100),
    db
      .from("trader_strategy_proposals")
      .select("id,name,status,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    ownerContext(user.id),
  ]);
  return NextResponse.json({
    messages: messages.data ?? [],
    proposals: proposals.data ?? [],
    context,
    aiAvailable: Boolean(process.env.AI_API_KEY && process.env.AI_MODEL),
    readOnly: true,
    liveLocked: true,
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "TRADER_UNAVAILABLE" }, { status: 503 });
  if (body.action === "DRAFT_STRATEGY") {
    const name = String(body.name ?? "")
      .trim()
      .slice(0, 100);
    const specification = body.specification;
    if (!name || !specification || typeof specification !== "object")
      return NextResponse.json(
        { error: "INVALID_STRATEGY_DRAFT" },
        { status: 400 },
      );
    const result = await admin
      .from("trader_strategy_proposals")
      .insert({ user_id: user.id, name, specification, status: "DRAFT" })
      .select("id,status")
      .single();
    return result.error
      ? NextResponse.json({ error: "DRAFT_FAILED" }, { status: 503 })
      : NextResponse.json(result.data, { status: 201 });
  }
  if (body.action === "PAPER_TEST_CONTROL") {
    if (body.confirmed !== true)
      return NextResponse.json(
        { error: "OWNER_CONFIRMATION_REQUIRED" },
        { status: 409 },
      );
    const enable = body.enabled === true;
    const { data: system } = await admin
      .from("system_state")
      .select("mode,emergency_stop_active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (
      system?.mode !== "PAPER" ||
      process.env.LIVE_TRADING_ENABLED === "true" ||
      process.env.BROKER_ADAPTER !== "ALPACA_PAPER"
    )
      return NextResponse.json(
        { error: "PAPER_TEST_LIVE_LOCKED" },
        { status: 423 },
      );
    if (enable && system?.emergency_stop_active)
      return NextResponse.json(
        { error: "EMERGENCY_STOP_ACTIVE" },
        { status: 423 },
      );
    const updated = await admin
      .from("auto_trader_config")
      .update({ paper_test_mode: enable, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (updated.error)
      return NextResponse.json(
        { error: "PAPER_TEST_UPDATE_FAILED" },
        { status: 503 },
      );
    await admin.from("audit_events").insert({
      user_id: user.id,
      action: enable
        ? "PAPER_AUTOMATION_TEST_ENABLED"
        : "PAPER_AUTOMATION_TEST_STOPPED",
      metadata: {
        confirmedByOwner: true,
        environment: "PAPER",
        source: "TRADER_CHAT",
      },
    });
    return NextResponse.json({
      paperTestMode: enable,
      confirmed: true,
      liveLocked: true,
    });
  }
  if (body.action && body.action !== "MESSAGE")
    return NextResponse.json({ error: "READ_ONLY_ACTION" }, { status: 403 });
  const question = String(body.message ?? "")
    .trim()
    .slice(0, 2000);
  if (!question)
    return NextResponse.json({ error: "MESSAGE_REQUIRED" }, { status: 400 });
  const context = await ownerContext(user.id);
  if (!context)
    return NextResponse.json(
      { error: "TRADER_CONTEXT_UNAVAILABLE" },
      { status: 503 },
    );
  let reply = deterministicReply(question, context);
  const ai = await new OpenAIResponsesResearchProvider().synthesize({
    ownerQuestion: question,
    verifiedSystemContext: context,
    deterministicAnswer: reply,
  });
  if (ai?.executiveSummary) reply = ai.executiveSummary;
  const inserted = await admin
    .from("trader_messages")
    .insert([
      {
        user_id: user.id,
        role: "OWNER",
        content: question,
        context_snapshot: {},
        actions: [],
        proactive: false,
      },
      {
        user_id: user.id,
        role: "TRADER",
        content: reply,
        context_snapshot: context,
        actions,
        proactive: false,
      },
    ])
    .select("id,role,content,actions,proactive,created_at");
  return inserted.error
    ? NextResponse.json({ error: "TRADER_MESSAGE_FAILED" }, { status: 503 })
    : NextResponse.json({
        messages: inserted.data,
        aiUsed: Boolean(ai),
        readOnly: true,
      });
}
