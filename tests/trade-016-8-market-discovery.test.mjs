import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  deriveUsSession,
  exchangeRegion,
  matchesAsset,
  normalizeAsset,
  rankMarketFocus,
  sessionTone,
} from "../src/services/market-data/asset-discovery.ts";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const raw = (symbol, name = `${symbol} Inc.`) => ({
  symbol,
  name,
  asset_class: "us_equity",
  exchange: "NASDAQ",
  tradable: true,
  shortable: true,
  fractionable: true,
  attributes: ["overnight_tradable"],
});

test("authoritative OPEN clock maps to green regular status", () => {
  assert.equal(
    deriveUsSession(new Date("2026-08-17T14:00:00Z"), { is_open: true }),
    "REGULAR",
  );
  assert.equal(sessionTone("REGULAR"), "open");
});

test("closed and extended sessions map to red and amber", () => {
  assert.equal(sessionTone("CLOSED"), "closed");
  for (const session of ["PRE_MARKET", "AFTER_HOURS", "OVERNIGHT"])
    assert.equal(sessionTone(session), "extended");
});

test("provider-unsupported clocks remain explicitly unknown", () => {
  const ui = read("components/professional-market-dashboard.tsx");
  assert.match(ui, /LOCAL MARKET TIME · STATUS UNKNOWN/);
  assert.match(ui, /index === 0 && discovery\?\.market\.authoritative/);
});

test("asset metadata preserves type, tradability and deterministic exchange region", () => {
  const stock = normalizeAsset(raw("AAPL", "Apple Inc."), "REGULAR");
  const etf = normalizeAsset(raw("SPY", "SPDR S&P 500 ETF Trust"), "REGULAR");
  assert.equal(stock.assetType, "STOCK");
  assert.equal(etf.assetType, "ETF");
  assert.equal(stock.region, "United States");
  assert.equal(stock.tradable, true);
  assert.equal(exchangeRegion("LSE"), "Region unavailable");
});

test("dropdown search supports ticker, name, exchange and asset type", () => {
  const asset = normalizeAsset(raw("AAPL", "Apple Inc."), "REGULAR");
  for (const query of ["AAPL", "apple", "nasdaq", "stock"])
    assert.equal(matchesAsset(asset, query), true);
});

test("Top 5 ordering is deterministic and only uses real screener evidence", () => {
  const assets = ["AAPL", "NVDA", "MSFT", "AMD", "TSLA", "META"].map((symbol) =>
    normalizeAsset(raw(symbol), "REGULAR"),
  );
  const focus = rankMarketFocus(
    assets,
    [
      { symbol: "NVDA" },
      { symbol: "AAPL" },
      { symbol: "MSFT" },
      { symbol: "AMD" },
      { symbol: "TSLA" },
    ],
    [{ symbol: "AAPL" }, { symbol: "META" }],
  );
  assert.deepEqual(
    focus.map((item) => item.symbol),
    ["AAPL", "NVDA", "MSFT", "AMD", "TSLA"],
  );
  assert.match(focus[0].reason, /most active|top mover/);
  assert.deepEqual(rankMarketFocus(assets, [], []), []);
});

test("asset endpoint uses Alpaca assets, clock, most-active and movers with three-minute refresh", () => {
  const route = read("app/api/assets/route.ts");
  assert.match(route, /\/v2\/assets\?status=active/);
  assert.match(route, /\/v2\/clock/);
  assert.match(route, /screener\/stocks\/most-actives/);
  assert.match(route, /screener\/stocks\/movers/);
  assert.match(route, /refreshAfterMs: 180_000/);
  assert.match(route, /topFocusAvailable: focus\.length > 0/);
});

test("shared selector pins Top 5, provides fallback, metadata and chart selection", () => {
  const selector = read("components/asset-discovery-select.tsx");
  const charts = read("components/trade-016-workspaces.tsx");
  const paper = read("components/trading-command-center.tsx");
  assert.match(selector, /TOP 5 MARKET FOCUS/);
  assert.match(selector, /TOP 5 TEMPORARILY UNAVAILABLE/);
  assert.match(selector, /Search ticker, company, exchange, or type/);
  assert.match(charts, /AssetDiscoverySelect/);
  assert.match(paper, /label="Paper order asset"/);
});

test("market overview exposes only provider-backed discovery categories", () => {
  const ui = read("components/professional-market-dashboard.tsx");
  for (const category of [
    "TOP 5",
    "MOST ACTIVE",
    "TOP GAINERS",
    "TOP LOSERS",
    "STOCKS",
    "ETFS",
  ])
    assert.match(ui, new RegExp(category));
  assert.doesNotMatch(ui, /guaranteed trades|best guaranteed stocks/i);
});

test("PAPER session guards and LIVE lock remain unchanged", () => {
  const orders = read("app/api/broker/orders/route.ts");
  const permission = read("src/services/trade-permission.ts");
  assert.match(orders, /MARKET_CLOSED/);
  assert.match(orders, /STALE_DATA/);
  assert.match(permission, /requested === "LIVE"/);
  assert.doesNotMatch(
    read("app/api/assets/route.ts"),
    /submitOrder|cancelOrder|TradePermissionService/,
  );
});

test("responsive discovery styles prevent long names and clocks overflowing", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.market-clock\.status-regular/);
  assert.match(css, /\.market-clock\.status-closed/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
