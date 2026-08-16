import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const allowedCurrencies = new Set(["USD", "ZAR", "GBP", "EUR"]),
  allowedTimeframes = new Set([
    "1Min",
    "5Min",
    "15Min",
    "30Min",
    "1Hour",
    "4Hour",
    "1Day",
    "1Week",
  ]);
const defaults = {
  layout: [
    "status",
    "account",
    "chart",
    "positions",
    "risk",
    "markets",
    "opportunities",
    "health",
  ],
  display_currency: "USD",
  watchlist: [
    "SPY",
    "QQQ",
    "DIA",
    "IWM",
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "AMD",
    "TSLA",
  ],
};
const fxRateBaseUrl =
  process.env.FX_RATE_BASE_URL ?? "https://api.frankfurter.dev";
async function context() {
  const db = await createSupabaseServerClient();
  const { data } = db ? await db.auth.getUser() : { data: { user: null } };
  return { db, user: data.user };
}
const alpacaHeaders = {
  "APCA-API-KEY-ID": process.env.ALPACA_API_KEY ?? "",
  "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET ?? "",
};
export async function GET(request: Request) {
  const { db, user } = await context();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(request.url),
    symbol = (url.searchParams.get("symbol") ?? "SPY").toUpperCase(),
    timeframe = allowedTimeframes.has(url.searchParams.get("timeframe") ?? "")
      ? String(url.searchParams.get("timeframe"))
      : "15Min";
  if (!/^[A-Z.]{1,10}$/.test(symbol))
    return NextResponse.json({ error: "INVALID_SYMBOL" }, { status: 400 });
  const [preferencesResult, accountResult, positionsResult, equityResult] =
    await Promise.all([
      db
        .from("dashboard_preferences")
        .select("layout,display_currency,watchlist")
        .eq("user_id", user.id)
        .maybeSingle(),
      db
        .from("paper_portfolio_current")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      db
        .from("paper_positions")
        .select(
          "symbol,side,quantity,entry_price,current_price,market_value,unrealized_pl,unrealized_pl_pct,stop_loss,take_profit,strategy_name,trade_origin,opened_at,status",
        )
        .eq("user_id", user.id)
        .in("status", ["OPEN", "EXIT_PENDING"]),
      db
        .from("paper_portfolio_pl_history")
        .select("sampled_at,equity")
        .eq("user_id", user.id)
        .order("sampled_at", { ascending: false })
        .limit(390),
    ]);
  const preferences = { ...defaults, ...(preferencesResult.data ?? {}) },
    watchlist = (preferences.watchlist as string[]).slice(0, 30);
  const days =
      timeframe === "1Week"
        ? 1825
        : timeframe === "1Day"
          ? 365
          : ["1Hour", "4Hour"].includes(timeframe)
            ? 60
            : 7,
    start = new Date(Date.now() - days * 86400000).toISOString();
  const [snapshotsResponse, barsResponse, rateResponse] =
    await Promise.allSettled([
      fetch(
        `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(watchlist.join(","))}&feed=iex`,
        { headers: alpacaHeaders, signal: AbortSignal.timeout(10000) },
      ),
      fetch(
        `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${timeframe}&start=${encodeURIComponent(start)}&limit=1000&adjustment=raw&feed=iex&sort=asc`,
        { headers: alpacaHeaders, signal: AbortSignal.timeout(10000) },
      ),
      preferences.display_currency === "USD"
        ? Promise.resolve(null)
        : fetch(
            `${fxRateBaseUrl}/v2/rate/USD/${preferences.display_currency}`,
            { signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } },
          ),
    ]);
  const snapshots =
    snapshotsResponse.status === "fulfilled" && snapshotsResponse.value.ok
      ? await snapshotsResponse.value.json()
      : {};
  const barsPayload =
    barsResponse.status === "fulfilled" && barsResponse.value.ok
      ? await barsResponse.value.json()
      : { bars: [] };
  const ratePayload =
    rateResponse.status === "fulfilled" && rateResponse.value?.ok
      ? await rateResponse.value.json()
      : null;
  return NextResponse.json({
    source: "ALPACA_IEX",
    account: accountResult.data,
    positions: positionsResult.data ?? [],
    equity: (equityResult.data ?? []).reverse(),
    marketOverview: watchlist.map((ticker) => ({
      symbol: ticker,
      ...(snapshots?.[ticker] ?? {}),
    })),
    chart: {
      symbol,
      timeframe,
      bars: (barsPayload.bars ?? []).map(
        (bar: Record<string, number | string>) => ({
          time: String(bar.t),
          open: Number(bar.o),
          high: Number(bar.h),
          low: Number(bar.l),
          close: Number(bar.c),
          volume: Number(bar.v),
        }),
      ),
    },
    conversion: {
      currency: preferences.display_currency,
      rate:
        preferences.display_currency === "USD"
          ? 1
          : Number(ratePayload?.rate ?? 0),
      timestamp: ratePayload?.date ?? null,
      displayOnly: true,
    },
    preferences,
  });
}
export async function PUT(request: Request) {
  const { db, user } = await context();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json(),
    currency = String(body.displayCurrency ?? "USD"),
    watchlist = Array.isArray(body.watchlist)
      ? body.watchlist
          .map((item: unknown) => String(item).toUpperCase())
          .filter((item: string) => /^[A-Z.]{1,10}$/.test(item))
          .slice(0, 30)
      : defaults.watchlist,
    layout = Array.isArray(body.layout)
      ? body.layout.map(String).slice(0, 20)
      : defaults.layout;
  if (!allowedCurrencies.has(currency))
    return NextResponse.json({ error: "INVALID_CURRENCY" }, { status: 400 });
  await db.from("dashboard_preferences").upsert({
    user_id: user.id,
    display_currency: currency,
    watchlist,
    layout,
    updated_at: new Date().toISOString(),
  });
  return NextResponse.json({ saved: true });
}
