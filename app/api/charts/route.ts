import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const timeframes = new Set([
  "1Min",
  "5Min",
  "15Min",
  "30Min",
  "1Hour",
  "4Hour",
  "1Day",
  "1Week",
]);
export async function GET(request: Request) {
  const user = await getAuthenticatedOwner(),
    db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url),
    symbol = (url.searchParams.get("symbol") ?? "SPY").toUpperCase(),
    timeframe = url.searchParams.get("timeframe") ?? "15Min";
  if (!/^[A-Z.]{1,10}$/.test(symbol) || !timeframes.has(timeframe))
    return NextResponse.json(
      { error: "Invalid chart selection" },
      { status: 400 },
    );
  const [drawings, preferences] = await Promise.all([
    db
      .from("chart_drawings")
      .select("id,drawing_type,geometry,style,label,created_at")
      .eq("user_id", user.id)
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .order("created_at"),
    db
      .from("chart_preferences")
      .select("indicators,overlay_settings,watchlist")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  return NextResponse.json({
    symbol,
    timeframe,
    drawings: drawings.data ?? [],
    preferences: preferences.data ?? {
      indicators: [
        { type: "SMA", period: 20 },
        { type: "EMA", period: 12 },
        { type: "RSI", period: 14 },
        { type: "MACD", fast: 12, slow: 26, signal: 9 },
        { type: "VOLUME" },
      ],
      overlay_settings: { positions: true, orders: true, closedTrades: false },
      watchlist: ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
    },
  });
}
export async function PUT(request: Request) {
  const user = await getAuthenticatedOwner(),
    db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (body.preferences)
    await db.from("chart_preferences").upsert({
      user_id: user.id,
      indicators: body.preferences.indicators ?? [],
      overlay_settings: body.preferences.overlaySettings ?? {},
      watchlist: (body.preferences.watchlist ?? [])
        .map((v: unknown) => String(v).toUpperCase())
        .filter((v: string) => /^[A-Z.]{1,10}$/.test(v))
        .slice(0, 40),
      updated_at: new Date().toISOString(),
    });
  if (body.drawing)
    await db.from("chart_drawings").insert({
      user_id: user.id,
      symbol: String(body.symbol).toUpperCase(),
      timeframe: String(body.timeframe),
      drawing_type: String(body.drawing.type),
      geometry: body.drawing.geometry ?? {},
      style: body.drawing.style ?? {},
      label: String(body.drawing.label ?? "").slice(0, 200),
    });
  return NextResponse.json({ saved: true });
}
export async function DELETE(request: Request) {
  const user = await getAuthenticatedOwner(),
    db = await createSupabaseServerClient();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  let query = db.from("chart_drawings").delete().eq("user_id", user.id);
  if (body.id) query = query.eq("id", body.id);
  else
    query = query
      .eq("symbol", String(body.symbol).toUpperCase())
      .eq("timeframe", String(body.timeframe));
  await query;
  return NextResponse.json({ deleted: true });
}
