import { createClient } from "@supabase/supabase-js";
import { ProtectiveExitService } from "../src/services/broker/protective-exit-service.ts";
import { fetchAlpacaHistoricalBars } from "../src/services/backtesting/historical-data.ts";
import { runHistoricalBacktest } from "../src/services/backtesting/engine.ts";

const PAPER_URL = "https://paper-api.alpaca.markets";
const DATA_URL = "https://data.alpaca.markets";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALPACA_BROKER_API_KEY",
  "ALPACA_BROKER_API_SECRET",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
];
for (const name of required)
  if (!process.env[name]) throw new Error(`MISSING_ENV:${name}`);
if (process.env.TRADING_RUNTIME_MODE !== "HOSTED_PRODUCTION")
  throw new Error("HOSTED_PRODUCTION_REQUIRED");
if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_ENVIRONMENT ?? "PAPER") !== "PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_BASE_URL ?? PAPER_URL) !== PAPER_URL)
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_DATA_FEED ?? "iex").toLowerCase() !== "iex")
  throw new Error("IEX_FEED_REQUIRED");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const workerId = process.env.WORKER_ID ?? "railway-trading-engine";
const intervalMs = Math.max(
  10_000,
  Number(process.env.WORKER_INTERVAL_MS ?? 30_000),
);
const symbols = (process.env.WORKER_SCAN_SYMBOLS ?? "AAPL,MSFT,NVDA,SPY")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const headers = (key, secret) => ({
  "APCA-API-KEY-ID": key,
  "APCA-API-SECRET-KEY": secret,
});
const brokerHeaders = () =>
  headers(
    process.env.ALPACA_BROKER_API_KEY,
    process.env.ALPACA_BROKER_API_SECRET,
  );
let stopping = false;

async function json(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
  return response.status === 204 ? null : response.json();
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const masked = (value) => {
  const text = String(value ?? "");
  return text.length > 4 ? `****${text.slice(-4)}` : "****";
};

async function submitProtectivePaperExit(ownerId, position, reason) {
  if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
    throw new Error("LIVE_TRADING_LOCKED");
  if ((process.env.ALPACA_BROKER_BASE_URL ?? PAPER_URL) !== PAPER_URL)
    throw new Error("LIVE_TRADING_LOCKED");
  const quantity = Math.abs(number(position.qty));
  if (!quantity) return;
  const clientOrderId = `protective:${ownerId}:${position.asset_id}`;
  const claim = {
    user_id: ownerId,
    broker_position_id: String(position.asset_id),
    reason,
    client_order_id: clientOrderId,
    status: "CLAIMED",
    trigger_price: number(position.current_price),
  };
  const { error: claimError } = await db
    .from("paper_position_exit_claims")
    .insert(claim);
  if (claimError) return; // Unique claim means another cycle/restart owns the exit.
  try {
    const brokerAdapter = {
      submitPaperOrder: async (order) => {
        const response = await json(`${PAPER_URL}/v2/orders`, {
          method: "POST",
          headers: { ...brokerHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            symbol: order.symbol,
            qty: String(order.quantity),
            side: order.direction.toLowerCase(),
            type: "market",
            time_in_force: "day",
            client_order_id: order.clientOrderId,
          }),
        });
        return {
          brokerOrderId: String(response.id),
          status: "ACCEPTED",
          message: "Alpaca PAPER protective exit accepted.",
          mode: "PAPER",
        };
      },
    };
    const exitService = new ProtectiveExitService(brokerAdapter, {
      mode: "PAPER",
      autoTraderStatus: "PAUSED",
      riskState: "LOCKED",
      emergencyStopActive: true,
    });
    const result = await exitService.submit({
      symbol: String(position.symbol).toUpperCase(),
      direction: String(position.side) === "short" ? "BUY" : "SELL",
      quantity,
      openQuantity: quantity,
      reason,
      clientOrderId,
    });
    await db
      .from("paper_position_exit_claims")
      .update({
        status: "SUBMITTED",
        broker_order_id: result.brokerOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq("client_order_id", clientOrderId);
    await db
      .from("paper_positions")
      .update({ status: "EXIT_PENDING", exit_reason: reason })
      .eq("user_id", ownerId)
      .eq("broker_position_id", String(position.asset_id));
    await db.from("audit_events").insert({
      user_id: ownerId,
      action: "PAPER_POSITION_EXIT_SUBMITTED",
      metadata: {
        mode: "PAPER",
        broker: "ALPACA_PAPER",
        reason,
        symbol: position.symbol,
        client_order_id: clientOrderId,
      },
    });
  } catch (error) {
    await db
      .from("paper_position_exit_claims")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "EXIT_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("client_order_id", clientOrderId);
  }
}

async function synchronizeOwnerPortfolio(
  ownerId,
  account,
  positions,
  orders,
  fills,
  portfolioHistory,
  asOf,
) {
  const [{ data: controls }, { data: legacyPositions }] = await Promise.all([
    db
      .from("paper_positions")
      .select(
        "broker_position_id,stop_loss,take_profit,strategy_name,opened_at",
      )
      .eq("user_id", ownerId),
    db
      .from("positions")
      .select("symbol,stop_loss,take_profit,source,opened_at")
      .eq("user_id", ownerId),
  ]);
  const legacyMap = new Map(
    (legacyPositions ?? []).map((row) => [
      String(row.symbol).toUpperCase(),
      row,
    ]),
  );
  const controlMap = new Map(
    (controls ?? []).map((row) => [row.broker_position_id, row]),
  );
  const openIds = positions.map((position) => String(position.asset_id));
  for (const position of positions) {
    const id = String(position.asset_id);
    const control =
      controlMap.get(id) ??
      legacyMap.get(String(position.symbol).toUpperCase());
    await db.from("paper_positions").upsert(
      {
        user_id: ownerId,
        broker_position_id: id,
        symbol: String(position.symbol).toUpperCase(),
        side: String(position.side) === "short" ? "SHORT" : "LONG",
        quantity: Math.abs(number(position.qty)),
        entry_price: number(position.avg_entry_price),
        current_price: number(position.current_price),
        market_value: Math.abs(number(position.market_value)),
        unrealized_pl: number(position.unrealized_pl),
        unrealized_pl_pct: number(position.unrealized_plpc) * 100,
        stop_loss: control?.stop_loss ?? null,
        take_profit: control?.take_profit ?? null,
        strategy_name:
          control?.strategy_name ??
          control?.source ??
          "External / Manual PAPER",
        status: "OPEN",
        opened_at: control?.opened_at ?? asOf,
        last_synced_at: asOf,
      },
      { onConflict: "user_id,broker_position_id" },
    );
    const price = number(position.current_price);
    const isLong = String(position.side) !== "short";
    const stopTriggered =
      control?.stop_loss != null &&
      (isLong
        ? price <= number(control.stop_loss)
        : price >= number(control.stop_loss));
    const targetTriggered =
      control?.take_profit != null &&
      (isLong
        ? price >= number(control.take_profit)
        : price <= number(control.take_profit));
    if (stopTriggered)
      await submitProtectivePaperExit(ownerId, position, "STOP_LOSS");
    else if (targetTriggered)
      await submitProtectivePaperExit(ownerId, position, "TAKE_PROFIT");
  }
  for (const prior of controls ?? [])
    if (!openIds.includes(prior.broker_position_id))
      await db
        .from("paper_positions")
        .update({ status: "CLOSED", closed_at: asOf, last_synced_at: asOf })
        .eq("user_id", ownerId)
        .eq("broker_position_id", prior.broker_position_id)
        .in("status", ["OPEN", "EXIT_PENDING"]);
  const unrealized = positions.reduce(
    (sum, position) => sum + number(position.unrealized_pl),
    0,
  );
  const exposure = positions.reduce(
    (sum, position) => sum + Math.abs(number(position.market_value)),
    0,
  );
  const intradayUnrealized = positions.reduce(
    (sum, position) => sum + number(position.unrealized_intraday_pl),
    0,
  );
  const dailyEquityChange =
    number(account.equity ?? account.portfolio_value) -
    number(account.last_equity);
  const realizedToday = dailyEquityChange - intradayUnrealized;
  await db.from("paper_portfolio_current").upsert({
    user_id: ownerId,
    account_id_masked: masked(account.account_number),
    equity: number(account.equity ?? account.portfolio_value),
    cash: number(account.cash),
    buying_power: number(account.buying_power),
    realized_pl_today: realizedToday,
    unrealized_pl: unrealized,
    open_exposure: exposure,
    position_count: positions.length,
    open_order_count: orders.length,
    source: "ALPACA_PAPER",
    as_of: asOf,
    updated_at: asOf,
  });
  await db.from("paper_portfolio_pl_history").upsert(
    {
      user_id: ownerId,
      sample_key: asOf.slice(0, 16),
      equity: number(account.equity ?? account.portfolio_value),
      realized_pl: realizedToday,
      unrealized_pl: unrealized,
      open_exposure: exposure,
      sampled_at: asOf,
    },
    { onConflict: "user_id,sample_key" },
  );
  if (fills.length)
    await db.from("paper_broker_fills").upsert(
      fills.map((fill) => ({
        user_id: ownerId,
        broker_execution_id: String(fill.id ?? fill.activity_id),
        broker_order_id: String(fill.order_id ?? ""),
        symbol: String(fill.symbol).toUpperCase(),
        side: String(fill.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
        quantity: number(fill.qty),
        price: number(fill.price),
        strategy_name: "Alpaca PAPER",
        executed_at: String(fill.transaction_time ?? asOf),
        raw: fill,
      })),
      { onConflict: "user_id,broker_execution_id", ignoreDuplicates: true },
    );
}

async function processBacktestJob() {
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("backtests")
    .update({ status: "QUEUED", error: "WORKER_RESTART_RECOVERY" })
    .eq("status", "RUNNING")
    .lt("started_at", staleBefore);
  const { data: queued } = await db
    .from("backtests")
    .select("id,user_id,configuration")
    .eq("status", "QUEUED")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!queued) return;
  const { data: claimed } = await db
    .from("backtests")
    .update({
      status: "RUNNING",
      progress: 5,
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", queued.id)
    .eq("status", "QUEUED")
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  try {
    const config = queued.configuration;
    const candles = await fetchAlpacaHistoricalBars(
      config.symbol,
      config.start,
      config.end,
      config.timeframe,
    );
    await db.from("backtests").update({ progress: 45 }).eq("id", queued.id);
    const result = runHistoricalBacktest(config, candles);
    await db.from("backtest_trades").upsert(
      result.trades.map((trade, index) => ({
        backtest_id: queued.id,
        user_id: queued.user_id,
        trade_index: index,
        symbol: trade.symbol,
        strategy: trade.strategy,
        direction: trade.direction,
        entry_timestamp: trade.entryTimestamp,
        entry_price: trade.entryPrice,
        exit_timestamp: trade.exitTimestamp,
        exit_price: trade.exitPrice,
        quantity: trade.quantity,
        stop_price: trade.stop,
        target_price: trade.target,
        gross_pl: trade.grossPl,
        costs: trade.costs,
        net_pl: trade.netPl,
        return_pct: trade.returnPct,
        exit_reason: trade.exitReason,
        duration_ms: trade.durationMs,
      })),
      { onConflict: "backtest_id,trade_index" },
    );
    await db
      .from("backtests")
      .update({
        status: "COMPLETED",
        progress: 100,
        metrics: result.metrics,
        assumptions: result.assumptions,
        equity_curve: result.equityCurve,
        drawdown_curve: result.drawdownCurve,
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
  } catch (error) {
    await db
      .from("backtests")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "BACKTEST_FAILED",
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
  }
}

async function cycle() {
  const startedAt = new Date().toISOString();
  await processBacktestJob();
  const { data: owners, error } = await db.from("profiles").select("id");
  if (error) throw error;
  const [account, positions, orders, fills, portfolioHistory, snapshots] =
    await Promise.all([
      json(`${PAPER_URL}/v2/account`, {
        headers: brokerHeaders(),
      }),
      json(`${PAPER_URL}/v2/positions`, {
        headers: brokerHeaders(),
      }),
      json(`${PAPER_URL}/v2/orders?status=open`, {
        headers: brokerHeaders(),
      }),
      json(
        `${PAPER_URL}/v2/account/activities/FILL?direction=desc&page_size=100`,
        { headers: brokerHeaders() },
      ),
      json(
        `${PAPER_URL}/v2/account/portfolio/history?period=1D&timeframe=1Min`,
        { headers: brokerHeaders() },
      ),
      json(
        `${DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`,
        {
          headers: headers(
            process.env.ALPACA_API_KEY,
            process.env.ALPACA_API_SECRET,
          ),
        },
      ),
    ]);
  for (const owner of owners ?? []) {
    const { data: state } = await db
      .from("system_state")
      .select("auto_trader_status,emergency_stop_active")
      .eq("user_id", owner.id)
      .maybeSingle();
    const autoTraderPermitted =
      state?.auto_trader_status === "ACTIVE" &&
      state?.emergency_stop_active === false;
    await synchronizeOwnerPortfolio(
      owner.id,
      account,
      positions,
      orders,
      fills,
      portfolioHistory,
      startedAt,
    );
    const metadata = {
      accountStatus: account?.status ?? "UNKNOWN",
      positionCount: positions?.length ?? 0,
      openOrderCount: orders?.length ?? 0,
      scannedSymbols: Object.keys(snapshots ?? {}),
      marketData: "ALPACA_IEX",
      broker: "ALPACA_PAPER",
      autoTrader: autoTraderPermitted ? "SCHEDULED" : "PAUSED",
      safety: "LIVE_LOCKED",
    };
    await db.from("trading_worker_heartbeats").upsert(
      {
        user_id: owner.id,
        worker_id: workerId,
        status: "ONLINE",
        runtime: "HOSTED_PRODUCTION",
        last_seen_at: new Date().toISOString(),
        version: process.env.WORKER_VERSION ?? "TRADE-011",
        metadata,
      },
      { onConflict: "user_id,worker_id" },
    );
    await db
      .from("trading_worker_runs")
      .insert({
        user_id: owner.id,
        worker_id: workerId,
        task_type: "HOSTED_CYCLE",
        idempotency_key: `${workerId}:${owner.id}:${startedAt.slice(0, 16)}`,
        status: "COMPLETED",
        details: metadata,
      })
      .then(() => undefined);
  }
}

async function loop() {
  try {
    await cycle();
    console.log(
      JSON.stringify({
        level: "info",
        event: "worker_cycle_complete",
        at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "worker_cycle_failed",
        message: error instanceof Error ? error.message : "UNKNOWN",
        at: new Date().toISOString(),
      }),
    );
  }
  if (!stopping) setTimeout(loop, intervalMs);
}
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await loop();
