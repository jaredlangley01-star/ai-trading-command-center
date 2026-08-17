import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
  brokerErrorPayload,
  BrokerError,
  RiskDecisionError,
} from "@/src/services/broker/errors";
import { TradePermissionService } from "@/src/services/trade-permission";
import { defaultRiskSettings } from "@/src/config/trading";
import type {
  BrokerOrderRequest,
  RiskSettings,
  SystemState,
  TradeRiskContext,
} from "@/src/domain/models";
import { ProductionRiskManager } from "@/src/services/risk-manager";
import { heartbeatIsFresh } from "@/src/services/diagnostics";
import {
  evaluateSessionQuoteFreshness,
  marketOrderAvailability,
} from "@/src/services/market-data/session-freshness";

export async function GET(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientOrderId = new URL(request.url).searchParams.get("clientOrderId");
  const requestedSymbol = new URL(request.url).searchParams.get("symbol");
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      { code: "SYNC_FAILED", message: "Order status is unavailable." },
      { status: 503 },
    );
  if (!clientOrderId && requestedSymbol) {
    const { data: quote } = await supabase
      .from("paper_market_quotes")
      .select(
        "bid,ask,last,provider,feed,as_of,market_session,clock_observed_at,is_trading_day,next_open,next_close",
      )
      .eq("user_id", user.id)
      .eq("symbol", requestedSymbol.toUpperCase())
      .maybeSingle();
    if (!quote)
      return NextResponse.json(
        { state: "STALE_DATA", message: "No synchronized quote is available." },
        { status: 404 },
      );
    const freshness = evaluateSessionQuoteFreshness({
      quoteTimestamp: quote.as_of,
      clock: {
        isOpen: quote.market_session === "REGULAR",
        nextOpen: quote.next_open,
        nextClose: quote.next_close,
        observedAt: quote.clock_observed_at,
        isTradingDay: quote.is_trading_day,
      },
      regularMaxAgeMs: Number(
        process.env.PAPER_REGULAR_QUOTE_MAX_AGE_MS ?? 120_000,
      ),
      extendedMaxAgeMs: Number(
        process.env.PAPER_EXTENDED_QUOTE_MAX_AGE_MS ?? 300_000,
      ),
    });
    return NextResponse.json({
      ...freshness,
      last: Number(quote.last),
      bid: Number(quote.bid),
      ask: Number(quote.ask),
      provider: quote.provider,
      feed: quote.feed,
    });
  }
  if (!clientOrderId)
    return NextResponse.json(
      { error: "Client order ID or symbol required" },
      { status: 400 },
    );
  const { data, error } = await supabase
    .from("paper_execution_requests")
    .select(
      "id,client_order_id,status,broker_order_id,error_code,error_message,queued_at,worker_received_at,broker_submitted_at,completed_at,updated_at",
    )
    .eq("user_id", user.id)
    .eq("client_order_id", clientOrderId)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { code: "SYNC_FAILED", message: "Order status query failed safely." },
      { status: 503 },
    );
  if (!data)
    return NextResponse.json(
      { code: "SYNC_FAILED", message: "Order request was not found." },
      { status: 404 },
    );
  return NextResponse.json({
    ...data,
    message: data.error_message,
    mode: "PAPER",
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as BrokerOrderRequest;
  const supabase = await createSupabaseServerClient();
  let reservedOrderId: string | null = null;
  if (!body.clientOrderId)
    return NextResponse.json(
      { error: "Client order ID required" },
      { status: 400 },
    );
  if (supabase) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id,status")
      .eq("user_id", user.id)
      .eq("client_order_id", body.clientOrderId)
      .maybeSingle();
    if (existing)
      return NextResponse.json({
        brokerOrderId: existing.id,
        status: existing.status,
        message: "Duplicate request safely returned the existing paper order.",
        mode: "PAPER",
        duplicate: true,
      });
    const { data: reserved, error: reservationError } = await supabase
      .from("orders")
      .insert({
        user_id: user.id,
        symbol: body.symbol.toUpperCase(),
        direction: body.direction,
        order_type: body.type,
        quantity: body.quantity,
        status: "DRAFT",
        mode: "PAPER",
        client_order_id: body.clientOrderId,
        source: "MANUAL",
      })
      .select("id")
      .single();
    if (reservationError)
      return NextResponse.json(
        {
          status: "REJECTED",
          message: "Duplicate or invalid paper order request blocked safely.",
          mode: "PAPER",
        },
        { status: 409 },
      );
    reservedOrderId = reserved.id;
  }
  const { data: stored } = supabase
    ? await supabase
        .from("system_state")
        .select("mode,auto_trader_status,risk_state,emergency_stop_active")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const state: SystemState = {
    mode: "PAPER",
    autoTraderStatus: stored?.auto_trader_status ?? "PAUSED",
    riskState: stored?.risk_state ?? "NORMAL",
    emergencyStopActive: stored?.emergency_stop_active ?? false,
  };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [
      settingsResult,
      dailyResult,
      positionsResult,
      portfolioStateResult,
      portfolioResult,
      quoteResult,
      workerResult,
    ] = supabase
      ? await Promise.all([
          supabase
            .from("risk_settings")
            .select("settings")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("daily_risk_state")
            .select("profit_loss,trades_opened,status,lock_reason")
            .eq("user_id", user.id)
            .eq("trading_date", today)
            .maybeSingle(),
          supabase
            .from("paper_positions")
            .select("symbol,quantity,entry_price,current_price,trade_origin")
            .eq("user_id", user.id)
            .in("status", ["OPEN", "EXIT_PENDING"]),
          supabase
            .from("risk_portfolio_state")
            .select("high_water_mark")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("paper_portfolio_current")
            .select("equity,cash,buying_power,as_of")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("paper_market_quotes")
            .select(
              "bid,ask,last,provider,feed,as_of,market_session,clock_observed_at,is_trading_day,next_open,next_close",
            )
            .eq("user_id", user.id)
            .eq("symbol", body.symbol.toUpperCase())
            .maybeSingle(),
          supabase
            .from("trading_worker_heartbeats")
            .select("last_seen_at,status")
            .eq("user_id", user.id)
            .order("last_seen_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
      : [
          { data: null },
          { data: null },
          { data: [] },
          { data: null },
          { data: null },
          { data: null },
          { data: null },
        ];
    if (!supabase || !heartbeatIsFresh(workerResult.data))
      throw new BrokerError(
        "WORKER_UNAVAILABLE",
        "WORKER_UNAVAILABLE: Railway Trading Worker heartbeat is stale or missing.",
        true,
      );
    if (!portfolioResult.data)
      throw new BrokerError(
        "SYNC_FAILED",
        "SYNC_FAILED: synchronized PAPER portfolio is unavailable.",
        true,
      );
    if (!quoteResult.data)
      throw new BrokerError(
        "SYNC_FAILED",
        "SYNC_FAILED: a current Railway Alpaca IEX quote is unavailable.",
        true,
      );
    const settings: RiskSettings = {
      ...defaultRiskSettings,
      ...(settingsResult.data?.settings as Partial<RiskSettings> | null),
    };
    const positionRows = positionsResult.data ?? [];
    const portfolioExposure = positionRows.reduce(
      (total, position) =>
        total +
        Number(position.quantity) *
          Number(position.current_price ?? position.entry_price),
      0,
    );
    const assetExposure = positionRows
      .filter((position) => position.symbol === body.symbol.toUpperCase())
      .reduce(
        (total, position) =>
          total +
          Number(position.quantity) *
            Number(position.current_price ?? position.entry_price),
        0,
      );
    const autoTraderExposure = positionRows
      .filter((position) => position.trade_origin === "AUTO_TRADER")
      .reduce(
        (total, position) =>
          total +
          Number(position.quantity) *
            Number(position.current_price ?? position.entry_price),
        0,
      );
    const quoteFreshness = evaluateSessionQuoteFreshness({
      quoteTimestamp: quoteResult.data.as_of,
      clock: {
        isOpen: quoteResult.data.market_session === "REGULAR",
        nextOpen: quoteResult.data.next_open,
        nextClose: quoteResult.data.next_close,
        observedAt: quoteResult.data.clock_observed_at,
        isTradingDay: quoteResult.data.is_trading_day,
      },
      regularMaxAgeMs: Number(
        process.env.PAPER_REGULAR_QUOTE_MAX_AGE_MS ?? 120_000,
      ),
      extendedMaxAgeMs: Number(
        process.env.PAPER_EXTENDED_QUOTE_MAX_AGE_MS ?? 300_000,
      ),
    });
    const quoteAgeMs = quoteFreshness.ageMs;
    if (body.type === "MARKET") {
      const availability = marketOrderAvailability(
        quoteFreshness.session,
        quoteFreshness.state,
      );
      if (!availability.allowed) {
        const code = availability.code!;
        const descriptions = {
          MARKET_CLOSED:
            "The US equity market is closed. The last regular-session quote remains visible, but this PAPER market order cannot be submitted.",
          ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION:
            "PAPER market orders are unavailable in the current extended-hours session.",
          STALE_DATA:
            "The latest Alpaca IEX quote exceeds the strict regular-session freshness limit.",
        } as const;
        throw new BrokerError(code, descriptions[code], false);
      }
    }
    const expectedPrice = Number(body.limitPrice ?? quoteResult.data.last ?? 0);
    const portfolioValue = Number(portfolioResult.data.equity ?? 0);
    const highWaterMark = Math.max(
      portfolioValue,
      Number(portfolioStateResult.data?.high_water_mark ?? 0),
    );
    const portfolioDrawdownPct =
      highWaterMark > 0
        ? ((highWaterMark - portfolioValue) / highWaterMark) * 100
        : 0;
    const riskContext: TradeRiskContext = {
      requestedCapital: expectedPrice * body.quantity,
      expectedPrice,
      stopLoss: body.stopLoss,
      dailyProfitLoss: Number(dailyResult.data?.profit_loss ?? 0),
      tradesToday: Number(dailyResult.data?.trades_opened ?? 0),
      concurrentPositions: positionRows.length,
      portfolioExposure,
      autoTraderExposure,
      assetExposure,
      portfolioValue,
      portfolioDrawdownPct,
      source: "MANUAL",
      emergencyStopActive: state.emergencyStopActive,
      systemLocked:
        state.riskState === "LOCKED" ||
        dailyResult.data?.status === "SYSTEM_LOCK",
      dailyLocked: dailyResult.data?.status === "DAILY_LOCK",
      dailyLockReason: dailyResult.data?.lock_reason ?? undefined,
    };
    const riskManager = new ProductionRiskManager(
      settings,
      async (context, decision) => {
        if (!supabase) return;
        await supabase.from("risk_decisions").insert({
          user_id: user.id,
          client_order_id: body.clientOrderId,
          symbol: body.symbol.toUpperCase(),
          source: context.source,
          decision: decision.status,
          reason: decision.reason,
          requested_capital: decision.requestedCapital,
          approved_capital: decision.approvedCapital,
          calculated_loss: decision.calculatedLoss,
          context: { ...context, mode: "PAPER" },
        });
        await supabase.from("daily_risk_state").upsert(
          {
            user_id: user.id,
            trading_date: today,
            profit_loss: context.dailyProfitLoss,
            trades_opened: context.tradesToday,
            status:
              decision.status === "DAILY_LOCK" ||
              decision.status === "SYSTEM_LOCK"
                ? decision.status
                : context.dailyLocked
                  ? "DAILY_LOCK"
                  : "NORMAL",
            lock_reason:
              decision.status === "DAILY_LOCK" ||
              decision.status === "SYSTEM_LOCK"
                ? decision.reason
                : context.dailyLocked
                  ? context.dailyLockReason
                  : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,trading_date" },
        );
        await supabase.from("risk_portfolio_state").upsert(
          {
            user_id: user.id,
            high_water_mark: highWaterMark,
            current_value: portfolioValue,
            drawdown_pct: portfolioDrawdownPct,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      },
    );
    const queueBroker = {
      submitPaperOrder: async () => {
        const { data: queued, error: queueError } = await supabase
          .from("paper_execution_requests")
          .insert({
            user_id: user.id,
            order_id: reservedOrderId,
            client_order_id: body.clientOrderId,
            symbol: body.symbol.toUpperCase(),
            direction: body.direction,
            quantity: body.quantity,
            order_type: body.type,
            limit_price: body.type === "LIMIT" ? body.limitPrice : null,
            stop_loss: body.stopLoss ?? null,
            source: "MANUAL",
            status: "QUEUED",
          })
          .select("id,status")
          .single();
        if (queueError || !queued)
          throw new BrokerError(
            "SYNC_FAILED",
            "SYNC_FAILED: durable PAPER execution request could not be created.",
            true,
          );
        return {
          brokerOrderId: queued.id,
          status: "QUEUED" as const,
          message:
            "PAPER order queued for the Railway Trading Worker. Alpaca has not accepted it yet.",
          mode: "PAPER" as const,
        };
      },
    };
    if (body.mode !== "PAPER")
      throw new BrokerError("LIVE_TRADING_LOCKED", "Live trading is locked.");
    if (!body.confirmed)
      throw new BrokerError(
        "PAPER_CONFIRMATION_REQUIRED",
        "Paper order confirmation is required.",
      );
    const decision = await riskManager.evaluateOrder(riskContext);
    if (decision.status !== "APPROVED") throw new RiskDecisionError(decision);
    const permission = new TradePermissionService(state, settings);
    if (!permission.canOpenTrade())
      throw new BrokerError(
        "TRADE_PERMISSION_DENIED",
        permission.getLockReason() ?? "Trade permission denied.",
      );
    const result = await queueBroker.submitPaperOrder();
    if (supabase) {
      await supabase
        .from("orders")
        .update({ status: result.status })
        .eq("id", reservedOrderId);
      await supabase.from("audit_events").insert({
        user_id: user.id,
        action: "PAPER_ORDER_QUEUED",
        metadata: {
          symbol: body.symbol,
          direction: body.direction,
          quantity: body.quantity,
          type: body.type,
          mode: "PAPER",
          client_order_id: body.clientOrderId,
          executionRequestId: result.brokerOrderId,
          market_data_provider: quoteResult.data.provider,
          market_data_feed: quoteResult.data.feed,
          quote_timestamp: quoteResult.data.as_of,
          quote_age_ms: quoteAgeMs,
          market_session: quoteFreshness.session,
          quote_freshness: quoteFreshness.state,
        },
      });
      await supabase.from("notification_events").upsert(
        {
          user_id: user.id,
          event_type: "ORDER_QUEUED",
          category: "TRADE",
          severity: "INFO",
          title: `${body.symbol.toUpperCase()} PAPER Order Queued`,
          body: `${body.direction} ${body.quantity} ${body.symbol.toUpperCase()} is queued for Railway broker submission.`,
          payload: {
            symbol: body.symbol.toUpperCase(),
            direction: body.direction,
            quantity: body.quantity,
            orderType: body.type,
          },
          deep_link: "/?section=Paper%20Trading",
          dedupe_key: `order:submitted:${body.clientOrderId}`,
        },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const failure = brokerErrorPayload(error);
    const rejected =
      failure.code === "TRADE_PERMISSION_DENIED" ||
      failure.code === "PAPER_CONFIRMATION_REQUIRED" ||
      failure.code === "LIVE_TRADING_LOCKED" ||
      failure.code === "MARKET_CLOSED" ||
      failure.code === "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION" ||
      failure.code === "STALE_DATA" ||
      failure.code === "ORDER_REJECTED";
    if (supabase) {
      if (reservedOrderId)
        await supabase
          .from("orders")
          .update({ status: rejected ? "REJECTED" : "FAILED" })
          .eq("id", reservedOrderId);
      await supabase.from("audit_events").insert({
        user_id: user.id,
        action: rejected ? "PAPER_ORDER_REJECTED" : "PAPER_ORDER_FAILED",
        metadata: {
          code: failure.code,
          message: failure.message,
          mode: "PAPER",
        },
      });
      await supabase.from("notification_events").upsert(
        {
          user_id: user.id,
          event_type: rejected ? "ORDER_REJECTED" : "ORDER_FAILED",
          category: "TRADE",
          severity: "WARNING",
          title: rejected ? "PAPER Order Rejected" : "PAPER Order Failed",
          body: `${body.symbol.toUpperCase()} PAPER order ${rejected ? "was rejected" : "failed before queueing"}: ${failure.code}.`,
          payload: { symbol: body.symbol.toUpperCase(), code: failure.code },
          deep_link: "/?section=Paper%20Trading",
          dedupe_key: `order:rejected:${body.clientOrderId}`,
        },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
      );
    }
    return NextResponse.json(failure, {
      status:
        failure.code === "LIVE_TRADING_LOCKED" ||
        failure.code === "TRADE_PERMISSION_DENIED"
          ? 423
          : 400,
    });
  }
}
