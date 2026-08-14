"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
type Position = {
  symbol: string;
  direction: string;
  entry: string;
  current: string;
  stop: string;
  target: string;
  size: string;
  pnl: number;
};
type DashboardData = {
  chart: {
    symbol: string;
    timeframe: string;
    bars: Array<{
      time: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  };
  equity: Array<{ sampled_at: string; equity: number }>;
  marketOverview: Array<Record<string, unknown>>;
  conversion: {
    currency: string;
    rate: number;
    timestamp: string | null;
    displayOnly: true;
  };
  preferences: {
    layout: string[];
    display_currency: string;
    watchlist: string[];
  };
};
const frames = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1H": "1Hour",
  "1D": "1Day",
};
const clocks = [
  ["New York", "America/New_York"],
  ["London", "Europe/London"],
  ["Johannesburg", "Africa/Johannesburg"],
  ["Tokyo", "Asia/Tokyo"],
  ["Sydney", "Australia/Sydney"],
] as const;
const num = (value: unknown) => Number(value ?? 0);
const refreshInterval = Math.max(
  10_000,
  Number(process.env.NEXT_PUBLIC_DASHBOARD_REFRESH_INTERVAL_MS ?? 30_000),
);
export function ProfessionalMarketDashboard({
  positions,
  portfolioValue,
}: {
  positions: Position[];
  portfolioValue: number;
}) {
  const [mode, setMode] = useState<"POSITION" | "SYMBOL" | "PORTFOLIO">(
      positions.length ? "POSITION" : "SYMBOL",
    ),
    [symbol, setSymbol] = useState(positions[0]?.symbol ?? "SPY"),
    [timeframe, setTimeframe] = useState("15Min"),
    [data, setData] = useState<DashboardData | null>(null),
    [filter, setFilter] = useState(""),
    [now, setNow] = useState(new Date()),
    [drag, setDrag] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(
      `/api/dashboard?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`,
      { cache: "no-store" },
    );
    if (response.ok) setData(await response.json());
  }, [symbol, timeframe]);
  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    const timer = setInterval(load, refreshInterval);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const selected = positions.find((position) => position.symbol === symbol);
  const save = async (
    next: Partial<{
      layout: string[];
      displayCurrency: string;
      watchlist: string[];
    }>,
  ) => {
    await fetch("/api/dashboard", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        layout: next.layout ?? data?.preferences.layout,
        displayCurrency:
          next.displayCurrency ?? data?.preferences.display_currency,
        watchlist: next.watchlist ?? data?.preferences.watchlist,
      }),
    });
    await load();
  };
  const order = data?.preferences.layout?.filter((key) =>
    ["chart", "markets"].includes(key),
  ) ?? ["chart", "markets"];
  const reorder = (target: string) => {
    if (!drag || drag === target || !data) return;
    const layout = [...data.preferences.layout],
      from = layout.indexOf(drag),
      to = layout.indexOf(target);
    if (from >= 0 && to >= 0) {
      layout.splice(from, 1);
      layout.splice(to, 0, drag);
      void save({ layout });
    }
    setDrag(null);
  };
  const chart = (
    <section
      className="module pro-chart-widget"
      draggable
      onDragStart={() => setDrag("chart")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => reorder("chart")}
    >
      <header className="module-head">
        <div>
          <span className="section-label">
            PROFESSIONAL MARKET CHART · ALPACA IEX
          </span>
          <p>Drag to reorder · scroll/pinch to zoom · drag chart to pan</p>
        </div>
        <div className="chart-controls">
          <select
            aria-label="Chart mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="POSITION">OPEN POSITION</option>
            <option value="SYMBOL">SYMBOL</option>
            <option value="PORTFOLIO">PORTFOLIO EQUITY</option>
          </select>
          <select
            aria-label="Current position"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {positions.map((position) => (
              <option key={position.symbol} value={position.symbol}>
                {position.symbol} —{" "}
                {position.direction === "BUY" ? "LONG" : "SHORT"}
              </option>
            ))}
            {data?.preferences.watchlist
              .filter((item) => !positions.some((p) => p.symbol === item))
              .map((item) => (
                <option key={item}>{item}</option>
              ))}
          </select>
          {Object.entries(frames).map(([label, value]) => (
            <button
              key={value}
              className={timeframe === value ? "active" : ""}
              onClick={() => setTimeframe(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <TradingChart data={data} mode={mode} position={selected} />
    </section>
  );
  const markets = (
    <section
      className="module market-overview-pro"
      draggable
      onDragStart={() => setDrag("markets")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => reorder("markets")}
    >
      <header className="module-head">
        <div>
          <span className="section-label">BATCHED MARKET OVERVIEW</span>
          <p>
            ALPACA IEX · one hosted snapshot request · actual supported symbols
          </p>
        </div>
        <input
          aria-label="Search market overview"
          placeholder="Search watchlist"
          value={filter}
          onChange={(e) => setFilter(e.target.value.toUpperCase())}
        />
      </header>
      <div className="market-grid">
        {(data?.marketOverview ?? [])
          .filter((item) => String(item.symbol).includes(filter))
          .map((item) => {
            const trade = item.latestTrade as
                | Record<string, unknown>
                | undefined,
              quote = item.latestQuote as Record<string, unknown> | undefined,
              daily = item.dailyBar as Record<string, unknown> | undefined,
              previous = item.prevDailyBar as
                | Record<string, unknown>
                | undefined,
              change = num(daily?.c) - num(previous?.c),
              pct = num(previous?.c) ? (change / num(previous?.c)) * 100 : 0;
            return (
              <article key={String(item.symbol)}>
                <strong>{String(item.symbol)}</strong>
                <b>{num(trade?.p || daily?.c).toFixed(2)}</b>
                <span className={change >= 0 ? "positive" : "negative"}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)} · {pct.toFixed(2)}%
                </span>
                <small>
                  Bid {num(quote?.bp).toFixed(2)} · Ask{" "}
                  {num(quote?.ap).toFixed(2)} · {trade?.t ? "CURRENT" : "STALE"}
                </small>
              </article>
            );
          })}
      </div>
    </section>
  );
  return (
    <div className="professional-dashboard">
      <div className="account-conversion">
        <div>
          <span>ACCOUNT VALUE</span>
          <strong>
            $
            {portfolioValue.toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}{" "}
            USD
          </strong>
          {data &&
            data.conversion.currency !== "USD" &&
            data.conversion.rate > 0 && (
              <b>
                ≈{" "}
                {(portfolioValue * data.conversion.rate).toLocaleString(
                  undefined,
                  { style: "currency", currency: data.conversion.currency },
                )}{" "}
                {data.conversion.currency}
              </b>
            )}
          <small>
            Display conversion only ·{" "}
            {data?.conversion.timestamp ?? "rate unavailable"}
          </small>
        </div>
        <label>
          DISPLAY CURRENCY
          <select
            value={data?.preferences.display_currency ?? "USD"}
            onChange={(e) => void save({ displayCurrency: e.target.value })}
          >
            {["USD", "ZAR", "GBP", "EUR"].map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            void save({
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
            })
          }
        >
          Restore Default Layout
        </button>
      </div>
      <div className="trading-clocks">
        {clocks.map(([city, zone]) => (
          <div key={zone}>
            <span>{city}</span>
            <b>
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: zone,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(now)}
            </b>
            <small>
              {zone}
              <br />
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: zone,
                dateStyle: "medium",
              }).format(now)}
            </small>
          </div>
        ))}
      </div>
      {order.map((widget) =>
        widget === "chart" ? (
          <div key="chart">{chart}</div>
        ) : (
          <div key="markets">{markets}</div>
        ),
      )}
    </div>
  );
}
function TradingChart({
  data,
  mode,
  position,
}: {
  data: DashboardData | null;
  mode: "POSITION" | "SYMBOL" | "PORTFOLIO";
  position?: Position;
}) {
  const container = useRef<HTMLDivElement>(null),
    api = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!container.current || !data) return;
    api.current?.remove();
    const chart = createChart(container.current, {
      autoSize: true,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "#08110e" },
        textColor: "#a9b8b1",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#17231e" },
        horzLines: { color: "#17231e" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#294038",
      },
      rightPriceScale: { borderColor: "#294038" },
      handleScroll: true,
      handleScale: true,
    });
    api.current = chart;
    if (mode === "PORTFOLIO") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#4d8cff",
        topColor: "rgba(77,140,255,.35)",
        bottomColor: "rgba(77,140,255,0)",
      });
      series.setData(
        data.equity.map((point) => ({
          time: Math.floor(Date.parse(point.sampled_at) / 1000) as UTCTimestamp,
          value: Number(point.equity),
        })),
      );
    } else {
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: "#27c98b",
        downColor: "#f05d6f",
        wickUpColor: "#27c98b",
        wickDownColor: "#f05d6f",
        borderVisible: false,
      });
      candle.setData(
        data.chart.bars.map((bar) => ({
          ...bar,
          time: Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp,
        })),
      );
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        color: "#50665d",
      });
      volume
        .priceScale()
        .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(
        data.chart.bars.map((bar) => ({
          time: Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp,
          value: bar.volume,
          color: bar.close >= bar.open ? "#27c98b55" : "#f05d6f55",
        })),
      );
      if (position)
        [
          ["ENTRY", position.entry, "#6fa8ff"],
          ["STOP", position.stop, "#f05d6f"],
          ["TARGET", position.target, "#27c98b"],
          ["CURRENT", position.current, "#f5c451"],
        ].forEach(([title, raw, color]) => {
          const value = Number(String(raw).replace(/[$,]/g, ""));
          if (value > 0)
            candle.createPriceLine({
              price: value,
              color,
              lineWidth: 2,
              lineStyle:
                title === "CURRENT" ? LineStyle.Solid : LineStyle.Dashed,
              axisLabelVisible: true,
              title,
            });
        });
    }
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      api.current = null;
    };
  }, [data, mode, position]);
  return (
    <div>
      <div className="position-overlay-summary">
        {position ? (
          <>
            <b>
              {position.symbol} ·{" "}
              {position.direction === "BUY" ? "LONG" : "SHORT"}
            </b>
            <span>Entry {position.entry}</span>
            <span>Current {position.current}</span>
            <span>Stop {position.stop}</span>
            <span>Target {position.target}</span>
            <span>Size {position.size}</span>
            <span className={position.pnl >= 0 ? "positive" : "negative"}>
              U/P&amp;L ${position.pnl.toFixed(2)}
            </span>
          </>
        ) : (
          <span>No open position overlay for this symbol.</span>
        )}
      </div>
      <div
        ref={container}
        className="lightweight-chart"
        aria-label={`${data?.chart.symbol ?? "Market"} candlestick chart with crosshair, price and time axes`}
      />
      <small className="chart-attribution">
        Charts by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts
        </a>
      </small>
    </div>
  );
}
