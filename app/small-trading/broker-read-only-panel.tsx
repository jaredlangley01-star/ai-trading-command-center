"use client";
import { useEffect, useState } from "react";
type Payload = {
  mode?: string; read_only?: boolean; connected?: boolean; error?: string;
  account?: { status?: string; currency?: string; cash?: string; buying_power?: string; equity?: string; portfolio_value?: string; trading_blocked?: boolean; account_blocked?: boolean };
  positions?: Array<{ symbol?: string; side?: string; qty?: string; avg_entry_price?: string; market_value?: string; unrealized_pl?: string }>;
  recent_orders?: Array<{ symbol?: string; side?: string; qty?: string; filled_qty?: string; filled_avg_price?: string; status?: string }>;
};
function money(value?: string, currency = "USD") {
  if (!value) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(number) : "—";
}
export default function BrokerReadOnlyPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/small-trading/broker", { cache: "no-store" });
        const payload = (await response.json()) as Payload;
        if (active) { setData(response.ok ? payload : { ...payload, connected: false }); setCheckedAt(new Date().toISOString()); }
      } catch {
        if (active) { setData({ connected: false, error: "BROKER_API_UNAVAILABLE" }); setCheckedAt(new Date().toISOString()); }
      } finally { if (active) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const connected = Boolean(data?.account && data.mode === "ALPACA_PAPER" && data.read_only);
  const currency = data?.account?.currency || "USD";
  return <section className="st-card st-panel st-broker-panel" aria-live="polite">
    <div className="st-panel-head"><div><h2>Broker account · read only</h2><p>Alpaca Paper account data, refreshed every 30 seconds</p></div><span className="st-tag">{loading ? "CHECKING" : connected ? "ALPACA PAPER" : "NOT CONNECTED"}</span></div>
    {!connected ? <div className="st-empty"><b>Paper account not connected</b><p>{data?.error ?? "Configure Alpaca Paper credentials in the secure server environment to load account values."}</p><small>No account figures are estimated or simulated in this panel.</small></div> : <>
      <div className="st-metrics st-broker-metrics">
        <article className="st-metric"><span>Portfolio value</span><strong>{money(data.account?.portfolio_value, currency)}</strong><small>Broker reported</small></article>
        <article className="st-metric"><span>Available cash</span><strong>{money(data.account?.cash, currency)}</strong><small>Broker reported</small></article>
        <article className="st-metric"><span>Equity</span><strong>{money(data.account?.equity, currency)}</strong><small>Broker reported</small></article>
        <article className="st-metric"><span>Buying power</span><strong>{money(data.account?.buying_power, currency)}</strong><small>Broker reported</small></article>
      </div>
      <div className="st-health-row"><span>Account status</span><b>{data.account?.status ?? "UNKNOWN"}</b></div>
      <div className="st-health-row"><span>Trading blocked</span><b>{data.account?.trading_blocked || data.account?.account_blocked ? "YES" : "NO"}</b></div>
      <h3 className="st-subheading">Broker positions</h3>
      {data.positions?.length ? <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Avg entry</th><th>Market value</th><th>Unrealised P&amp;L</th></tr></thead><tbody>{data.positions.map((p, i) => <tr key={i}><td>{p.symbol ?? "—"}</td><td>{p.side ?? "—"}</td><td>{p.qty ?? "—"}</td><td>{money(p.avg_entry_price, currency)}</td><td>{money(p.market_value, currency)}</td><td>{money(p.unrealized_pl, currency)}</td></tr>)}</tbody></table></div> : <p className="st-muted">No open broker positions.</p>}
      <h3 className="st-subheading">Recent broker orders</h3>
      {data.recent_orders?.length ? <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Symbol</th><th>Side</th><th>Quantity</th><th>Filled</th><th>Average fill</th><th>Status</th></tr></thead><tbody>{data.recent_orders.map((o, i) => <tr key={i}><td>{o.symbol ?? "—"}</td><td>{o.side ?? "—"}</td><td>{o.qty ?? "—"}</td><td>{o.filled_qty ?? "—"}</td><td>{money(o.filled_avg_price, currency)}</td><td>{o.status ?? "—"}</td></tr>)}</tbody></table></div> : <p className="st-muted">No recent orders returned by broker.</p>}
    </>}
    <p className="st-live-footnote">Last checked: {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "—"}. Read-only: this panel cannot submit, amend or cancel orders.</p>
  </section>;
}
