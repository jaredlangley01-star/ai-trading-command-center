export type MarketSession =
  | "REGULAR"
  | "PRE_MARKET"
  | "AFTER_HOURS"
  | "OVERNIGHT"
  | "CLOSED"
  | "UNKNOWN";

export type DiscoveredAsset = {
  symbol: string;
  name: string;
  assetType: "STOCK" | "ETF" | "OTHER";
  exchange: string;
  region: string;
  tradable: boolean;
  shortable: boolean;
  fractionable: boolean;
  overnightEligible: boolean;
  marketSession: MarketSession;
  marketStatus: string;
};

export type MarketFocus = DiscoveredAsset & {
  rank: number;
  reason: string;
  activityRank?: number;
  moverRank?: number;
};

const exchangeRegions: Record<string, string> = {
  NASDAQ: "United States",
  NASDAQGM: "United States",
  NASDAQGS: "United States",
  NASDAQCM: "United States",
  NYSE: "United States",
  NYSEARCA: "United States",
  ARCA: "United States",
  AMEX: "United States",
  BATS: "United States",
  OTC: "United States",
};

export function exchangeRegion(exchange: string) {
  return (
    exchangeRegions[exchange.toUpperCase().replaceAll(" ", "")] ??
    "Region unavailable"
  );
}

export function sessionTone(session: MarketSession) {
  if (session === "REGULAR") return "open";
  if (["PRE_MARKET", "AFTER_HOURS", "OVERNIGHT"].includes(session))
    return "extended";
  if (session === "CLOSED") return "closed";
  return "unknown";
}

export function deriveUsSession(
  now: Date,
  clock?: { is_open?: boolean; next_open?: string; next_close?: string },
): MarketSession {
  if (clock?.is_open) return "REGULAR";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  if (["Sat", "Sun"].includes(value("weekday"))) return "CLOSED";
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  if (minutes >= 240 && minutes < 570) return "PRE_MARKET";
  if (minutes >= 960 && minutes < 1200) return "AFTER_HOURS";
  if (minutes >= 1200 || minutes < 240) return "OVERNIGHT";
  return "CLOSED";
}

export function normalizeAsset(
  row: Record<string, unknown>,
  session: MarketSession,
): DiscoveredAsset {
  const exchange = String(row.exchange ?? "UNKNOWN");
  return {
    symbol: String(row.symbol ?? "").toUpperCase(),
    name: String(row.name ?? row.symbol ?? "Unknown asset"),
    assetType: String(row.asset_class ?? "").includes("crypto")
      ? "OTHER"
      : String(row.name ?? "")
            .toUpperCase()
            .includes(" ETF") ||
          String(row.name ?? "")
            .toUpperCase()
            .includes(" FUND")
        ? "ETF"
        : "STOCK",
    exchange,
    region: exchangeRegion(exchange),
    tradable: Boolean(row.tradable),
    shortable: Boolean(row.shortable),
    fractionable: Boolean(row.fractionable),
    overnightEligible: Boolean(
      row.attributes &&
        Array.isArray(row.attributes) &&
        row.attributes.includes("overnight_tradable"),
    ),
    marketSession: session,
    marketStatus: session.replaceAll("_", "-"),
  };
}

export function rankMarketFocus(
  assets: DiscoveredAsset[],
  mostActive: Array<{ symbol: string; volume?: number; trade_count?: number }>,
  movers: Array<{ symbol: string; percent_change?: number }>,
): MarketFocus[] {
  const activeRank = new Map(
    mostActive.map((item, index) => [item.symbol.toUpperCase(), index + 1]),
  );
  const moverRank = new Map(
    movers.map((item, index) => [item.symbol.toUpperCase(), index + 1]),
  );
  return assets
    .filter(
      (asset) =>
        asset.tradable &&
        (activeRank.has(asset.symbol) || moverRank.has(asset.symbol)),
    )
    .map((asset) => {
      const activity = activeRank.get(asset.symbol);
      const mover = moverRank.get(asset.symbol);
      const score = (activity ? 200 - activity : 0) + (mover ? 100 - mover : 0);
      const evidence = [
        activity ? `most active #${activity}` : "",
        mover ? `top mover #${mover}` : "",
      ].filter(Boolean);
      return {
        ...asset,
        rank: 0,
        reason: evidence.join(" · "),
        activityRank: activity,
        moverRank: mover,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, 5)
    .map((asset, index) => ({
      ...asset,
      rank: index + 1,
    }));
}

export function matchesAsset(asset: DiscoveredAsset, query: string) {
  const needle = query.trim().toUpperCase();
  return (
    !needle ||
    [asset.symbol, asset.name, asset.exchange, asset.assetType].some((value) =>
      value.toUpperCase().includes(needle),
    )
  );
}
