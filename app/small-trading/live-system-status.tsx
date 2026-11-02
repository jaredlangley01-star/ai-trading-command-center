"use client";

import { useEffect, useState } from "react";

type StatusPayload = {
  application?: string;
  mode?: string;
  health?: {
    status?: string;
    heartbeat_at?: string | null;
    component?: string;
    message?: string;
  };
  portfolio?: {
    open_position_count?: number;
    realized_pnl_from_ledger?: number;
    unrealized_pnl?: number;
    reconciliation_status?: string;
  };
  error?: string;
};

export default function LiveSystemStatus() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/small-trading/status", { cache: "no-store" });
        const payload = (await response.json()) as StatusPayload;
        if (active) {
          setData(response.ok ? payload : { error: payload.error ?? "BACKEND_NOT_CONNECTED" });
          setLastChecked(new Date().toISOString());
        }
      } catch {
        if (active) {
          setData({ error: "DASHBOARD_PROXY_UNAVAILABLE" });
          setLastChecked(new Date().toISOString());
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const health = data?.health?.status ?? "UNKNOWN";
  const connected = Boolean(data && !data.error && data.application === "small-trading-platform");
  const heartbeat = data?.health?.heartbeat_at
    ? new Date(data.health.heartbeat_at).toLocaleString()
    : "No heartbeat received";

  return (
    <section className="st-card st-panel st-live-status" aria-live="polite">
      <div className="st-panel-head">
        <div>
          <h2>Live engine connection</h2>
          <p>Read-only status refreshes every 15 seconds</p>
        </div>
        <span className={connected ? "st-health-unknown" : "st-health-unknown"}>
          {loading ? "CHECKING" : connected ? health : "NOT CONNECTED"}
        </span>
      </div>
      <div className="st-health-row"><span>Backend API</span><b className={connected ? "" : "st-muted"}>{connected ? "Reachable" : data?.error ?? "Checking connection"}</b></div>
      <div className="st-health-row"><span>Worker heartbeat</span><b className={health === "OK" ? "" : "st-muted"}>{heartbeat}</b></div>
      <div className="st-health-row"><span>Open simulated positions</span><b>{connected ? data?.portfolio?.open_position_count ?? "—" : "—"}</b></div>
      <div className="st-health-row"><span>Portfolio reconciliation</span><b className="st-muted">{connected ? data?.portfolio?.reconciliation_status ?? "UNKNOWN" : "NOT CONNECTED"}</b></div>
      <p className="st-live-footnote">Last checked: {lastChecked ? new Date(lastChecked).toLocaleTimeString() : "—"}. This panel does not place or modify orders.</p>
    </section>
  );
}
