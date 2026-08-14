import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { createPaperBroker } from "@/src/services/broker/factory";
import { PaperOrderService } from "@/src/services/broker/paper-order-service";
import { brokerErrorPayload, BrokerError } from "@/src/services/broker/errors";
import { TradePermissionService } from "@/src/services/trade-permission";
import { defaultRiskSettings } from "@/src/config/trading";
import type {
  BrokerOrderRequest,
  RiskSettings,
  SystemState,
  TradeRiskContext,
} from "@/src/domain/models";
import { ProductionRiskManager } from "@/src/services/risk-manager";
import { createPaperMarketData } from "@/src/services/market-data/factory";
import { assertFreshMarketQuote } from "@/src/services/market-data/freshness";
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
        source: body.source ?? "MANUAL",
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
    const selected = createPaperBroker();
    if (!selected)
      throw new BrokerError(
        "GATEWAY_UNAVAILABLE",
        "The cloud PAPER broker is not configured.",
      );
    const today = new Date().toISOString().slice(0, 10);
    const [
      settingsResult,
      dailyResult,
      positionsResult,
      portfolioStateResult,
      summary,
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
            .from("positions")
            .select("symbol,quantity,entry_price,current_price,source")
            .eq("user_id", user.id),
          supabase
            .from("risk_portfolio_state")
            .select("high_water_mark")
            .eq("user_id", user.id)
            .maybeSingle(),
          selected.broker.getAccountSummary(),
        ])
      : [
          { data: null },
          { data: null },
          { data: [] },
          { data: null },
          await selected.broker.getAccountSummary(),
        ];
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
      .filter((position) => position.source === "AUTO_TRADER")
      .reduce(
        (total, position) =>
          total +
          Number(position.quantity) *
            Number(position.current_price ?? position.entry_price),
        0,
      );
    const quote = await createPaperMarketData().getQuote({
      id: body.symbol.toLowerCase(),
      symbol: body.symbol.toUpperCase(),
      name: body.symbol.toUpperCase(),
      assetClass: "EQUITY",
      currency: summary.currency || "USD",
    });
    const freshness = assertFreshMarketQuote(quote);
    const expectedPrice = Number(body.limitPrice ?? quote?.last ?? 0);
    const portfolioValue = Number(
      summary.netLiquidation ?? summary.balance ?? 0,
    );
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
      source: body.source ?? "MANUAL",
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
    const service = new PaperOrderService(
      selected.broker,
      riskManager,
      new TradePermissionService(state, settings),
    );
    const result = await service.submit(
      { ...body, mode: "PAPER" },
      riskContext,
    );
    if (supabase) {
      await supabase.rpc("record_paper_trade_open", { p_user_id: user.id });
      await supabase
        .from("orders")
        .update({ status: result.status })
        .eq("id", reservedOrderId);
      await supabase.from("audit_events").insert({
        user_id: user.id,
        action: "PAPER_ORDER_SUBMITTED",
        metadata: {
          symbol: body.symbol,
          direction: body.direction,
          quantity: body.quantity,
          type: body.type,
          mode: "PAPER",
          client_order_id: body.clientOrderId,
          brokerOrderId: result.brokerOrderId,
          market_data_provider: quote.provider,
          market_data_feed: quote.feed,
          quote_timestamp: freshness.timestamp,
          quote_age_ms: freshness.ageMs,
        },
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const failure = brokerErrorPayload(error);
    if (supabase) {
      if (reservedOrderId)
        await supabase
          .from("orders")
          .update({ status: "REJECTED" })
          .eq("id", reservedOrderId);
      await supabase.from("audit_events").insert({
        user_id: user.id,
        action: "PAPER_ORDER_REJECTED",
        metadata: {
          code: failure.code,
          message: failure.message,
          mode: "PAPER",
        },
      });
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
