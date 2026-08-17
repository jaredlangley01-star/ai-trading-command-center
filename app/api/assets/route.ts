import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import {
  deriveUsSession,
  normalizeAsset,
  rankMarketFocus,
} from "@/src/services/market-data/asset-discovery";

export const dynamic = "force-dynamic";
const tradingUrl =
  process.env.ALPACA_BROKER_BASE_URL ?? "https://paper-api.alpaca.markets";
const dataUrl = process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets";
const headers = () => ({
  "APCA-API-KEY-ID":
    process.env.ALPACA_API_KEY ?? process.env.ALPACA_BROKER_API_KEY ?? "",
  "APCA-API-SECRET-KEY":
    process.env.ALPACA_API_SECRET ?? process.env.ALPACA_BROKER_API_SECRET ?? "",
});

async function json(url: string) {
  const response = await fetch(url, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`PROVIDER_${response.status}`);
  return response.json();
}

export async function GET(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query =
    new URL(request.url).searchParams.get("q")?.trim().toUpperCase() ?? "";
  const [clockResult, assetsResult, activeResult, moversResult] =
    await Promise.allSettled([
      json(`${tradingUrl}/v2/clock`),
      json(`${tradingUrl}/v2/assets?status=active&asset_class=us_equity`),
      json(`${dataUrl}/v1beta1/screener/stocks/most-actives?top=20`),
      json(`${dataUrl}/v1beta1/screener/stocks/movers?top=20`),
    ]);
  const clock =
    clockResult.status === "fulfilled" ? clockResult.value : undefined;
  const session = deriveUsSession(new Date(), clock);
  const rawAssets =
    assetsResult.status === "fulfilled" && Array.isArray(assetsResult.value)
      ? assetsResult.value
      : [];
  const assets = rawAssets
    .map((row: Record<string, unknown>) => normalizeAsset(row, session))
    .filter(
      (asset) =>
        asset.symbol &&
        (!query ||
          [asset.symbol, asset.name, asset.exchange, asset.assetType].some(
            (value) => value.toUpperCase().includes(query),
          )),
    )
    .slice(0, query ? 100 : 500);
  const active =
    activeResult.status === "fulfilled"
      ? (activeResult.value.most_actives ?? [])
      : [];
  const movers =
    moversResult.status === "fulfilled"
      ? [
          ...(moversResult.value.gainers ?? []),
          ...(moversResult.value.losers ?? []),
        ]
      : [];
  const focus = rankMarketFocus(
    rawAssets.map((row: Record<string, unknown>) =>
      normalizeAsset(row, session),
    ),
    active,
    movers,
  );
  return NextResponse.json({
    source: "ALPACA",
    refreshedAt: new Date().toISOString(),
    refreshAfterMs: 180_000,
    market: {
      session,
      status: session.replaceAll("_", "-"),
      isOpen: Boolean(clock?.is_open),
      timestamp: clock?.timestamp ?? null,
      nextOpen: clock?.next_open ?? null,
      nextClose: clock?.next_close ?? null,
      authoritative: clockResult.status === "fulfilled",
    },
    topFocus: focus,
    topFocusAvailable: focus.length > 0,
    categories: {
      mostActive: active.map((item: { symbol: string }) => item.symbol),
      topGainers:
        moversResult.status === "fulfilled"
          ? (moversResult.value.gainers ?? []).map(
              (item: { symbol: string }) => item.symbol,
            )
          : [],
      topLosers:
        moversResult.status === "fulfilled"
          ? (moversResult.value.losers ?? []).map(
              (item: { symbol: string }) => item.symbol,
            )
          : [],
    },
    assets,
  });
}
