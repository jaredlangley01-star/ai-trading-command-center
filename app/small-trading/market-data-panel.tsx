"use client";

import { useEffect, useState } from "react";

type Observation = {
  symbol: string;
  price?: number | null;
  source: string;
  observed_at: string;
  age_seconds: number;
  freshness: "FRESH" | "STALE";
  volume?: number | null;
};
type MarketResponse = { status?: string; observations?: Observation[]; error?: string };
type ClockResponse = { is_open?: boolean; timestamp?: string; next_open?: string; next_close?: string; error?: string };

function formatClock(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
}

export default function MarketDataPanel() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState<ClockResponse | null>(null);
  const [clockError, setClockError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const [marketResult, clockResult] = await Promise.allSettled([
        fetch("/api/small-trading/market", { cache: "no-store" }),
        fetch("/api/small-trading/market-clock", { cache: "no-store" }),
      ]);
      if (marketResult.status === "fulfilled") {
        try {
          const payload = await marketResult.value.json() as MarketResponse;
          if (!marketResult.value.ok) throw new Error(payload.error ?? "MARKET_STATUS_NOT_CONNECTED");
          if (active) { setData(payload); setError(null); }
        } catch (e) { if (active) setError(e instanceof Error ? e.message : "MARKET_STATUS_UNAVAILABLE"); }
      } else if (active) setError("MARKET_STATUS_UNAVAILABLE");
      if (clockResult.status === "fulfilled") {
        try {
          const payload = await clockResult.value.json() as ClockResponse;
          if (!clockResult.value.ok) throw new Error(payload.error ?? "MARKET_CLOCK_NOT_CONNECTED");
          if (active) { setClock(payload); setClockError(null); }
        } catch (e) { if (active) setClockError(e instanceof Error ? e.message : "MARKET_CLOCK_UNAVAILABLE"); }
      } else if (active) setClockError("MARKET_CLOCK_UNAVAILABLE");
      if (active) setCheckedAt(new Date().toISOString());
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return <section className="st-card st-panel">
    <div className="st-panel-head"><div><h2>Market data & session</h2><p>Broker clock and latest recorded observations</p></div><span className="st-tag">{data?.status ?? "UNKNOWN"}</span></div>
    <div className="st-health-row">
      <span><b>US equity market</b><small className="st-market-meta">{clock?.timestamp ? `Broker clock · ${formatClock(clock.timestamp)} ET` : clockError ?? "Broker clock not connected"}</small></span>
      <b>{clock?.is_open === true ? "OPEN" : clock?.is_open === false ? "CLOSED" : "UNKNOWN"}</b>
    </div>
    <div className="st-health-row">
      <span><b>Next open</b><small className="st-market-meta">{clock?.next_open ? "US Eastern Time" : "Requires Alpaca Paper connection"}</small></span>
      <b>{formatClock(clock?.next_open)}</b>
    </div>
    <div className="st-health-row">
      <span><b>Next close</b><small className="st-market-meta">US Eastern Time</small></span>
      <b>{formatClock(clock?.next_close)}</b>
    </div>
    <div className="st-divider" />
    {error ? <div className="st-empty"><b>Market diagnostics not connected</b><p>{error}</p></div> : !data?.observations?.length ? <div className="st-empty"><b>No market observations recorded</b><p>Freshness appears after the worker successfully reads market bars.</p></div> :
      <div>{data.observations.map(item => <div className="st-health-row" key={item.symbol}>
        <span><b>{item.symbol}</b><small className="st-market-meta">{item.source} · {new Date(item.observed_at).toLocaleString()}</small></span>
        <b className={item.freshness === "FRESH" ? "" : "st-muted"}>{item.price == null ? "—" : item.price.toFixed(2)} · {item.freshness} · {Math.round(item.age_seconds)}s</b>
      </div>)}</div>}
    <p className="st-live-footnote">Last checked: {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "—"}. Session status comes from Alpaca's broker clock, not a weekday estimate. IEX is not a consolidated all-exchange feed.</p>
  </section>;
}
