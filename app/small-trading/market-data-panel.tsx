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

export default function MarketDataPanel() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/small-trading/market", { cache: "no-store" });
        const payload = await response.json() as MarketResponse;
        if (!response.ok) throw new Error(payload.error ?? "MARKET_STATUS_NOT_CONNECTED");
        if (active) { setData(payload); setError(null); setCheckedAt(new Date().toISOString()); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "MARKET_STATUS_UNAVAILABLE");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return <section className="st-card st-panel">
    <div className="st-panel-head"><div><h2>Market data freshness</h2><p>Latest recorded observation per symbol · 120-second freshness limit</p></div><span className="st-tag">{data?.status ?? "UNKNOWN"}</span></div>
    {error ? <div className="st-empty"><b>Market diagnostics not connected</b><p>{error}</p></div> : !data?.observations?.length ? <div className="st-empty"><b>No market observations recorded</b><p>Freshness will be shown after the worker successfully reads market bars.</p></div> :
      <div>{data.observations.map(item => <div className="st-health-row" key={item.symbol}>
        <span><b>{item.symbol}</b><small className="st-market-meta">{item.source} · {new Date(item.observed_at).toLocaleString()}</small></span>
        <b className={item.freshness === "FRESH" ? "" : "st-muted"}>{item.price == null ? "—" : item.price.toFixed(2)} · {item.freshness} · {Math.round(item.age_seconds)}s</b>
      </div>)}</div>}
    <p className="st-live-footnote">Last checked: {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "—"}. IEX is not a consolidated all-exchange feed; fixture observations are labelled separately.</p>
  </section>;
}
