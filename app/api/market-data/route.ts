import { NextResponse } from "next/server";
import type { Asset } from "@/src/domain/models";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createPaperMarketData } from "@/src/services/market-data/factory";

const allowed = new Set(["AAPL", "NVDA", "MSFT", "AMZN"]);

export async function GET(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requested = new URL(request.url).searchParams
    .get("symbols")
    ?.split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => allowed.has(symbol)) ?? [
    "AAPL",
    "NVDA",
    "MSFT",
    "AMZN",
  ];
  const assets: Asset[] = requested.map((symbol) => ({
    id: symbol.toLowerCase(),
    symbol,
    name: symbol,
    assetClass: "EQUITY",
    currency: "USD",
  }));
  const provider = createPaperMarketData();
  try {
    const quotes = provider.getQuotes
      ? await provider.getQuotes(assets)
      : await Promise.all(assets.map((asset) => provider.getQuote(asset)));
    const lastUpdated =
      quotes
        .map((quote) => quote.asOf)
        .sort()
        .at(-1) ?? null;
    return NextResponse.json({
      status: "CONNECTED",
      provider: quotes[0]?.provider ?? "DEMO",
      feed: quotes[0]?.feed ?? "SIMULATED",
      source:
        quotes[0]?.provider === "ALPACA"
          ? "ALPACA — IEX"
          : quotes[0]?.provider === "IBKR"
            ? "IBKR PAPER DATA"
            : "SIMULATED/DEMO DATA",
      lastUpdated,
      ageMs: lastUpdated
        ? Math.max(0, Date.now() - Date.parse(lastUpdated))
        : null,
      quotes,
    });
  } catch {
    return NextResponse.json(
      {
        status: "DISCONNECTED",
        provider: "ALPACA",
        feed: "IEX",
        source: "MARKET DATA DISCONNECTED",
        lastUpdated: null,
        ageMs: null,
        quotes: [],
      },
      { status: 503 },
    );
  }
}
