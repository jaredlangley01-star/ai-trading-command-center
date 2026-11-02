"use client";
import { useEffect, useState } from "react";
type EventItem = { id: number; event_type: string; created_at: string; payload: Record<string, unknown> };
type EventsResponse = { events?: EventItem[]; error?: string };
function detail(event: EventItem) {
  const p = event.payload ?? {};
  const symbol = typeof p.symbol === "string" ? p.symbol : "";
  const message = typeof p.message === "string" ? p.message : "";
  const status = typeof p.status === "string" ? p.status : "";
  const signals = Array.isArray(p.signals) ? p.signals.length : 0;
  if (event.event_type === "OBSERVATION_CYCLE") return [symbol, status, signals ? signals + " strategy evaluations" : ""].filter(Boolean).join(" · ");
  if (event.event_type === "OBSERVATION_ERROR") return [symbol, typeof p.error_type === "string" ? p.error_type : "Worker error", message].filter(Boolean).join(" · ");
  if (event.event_type === "HEARTBEAT") return [typeof p.component === "string" ? p.component : "Worker", status, message].filter(Boolean).join(" · ");
  return Object.entries(p).slice(0, 3).map(([k, v]) => k + ": " + String(v)).join(" · ");
}
export default function ActivityFeed() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/small-trading/events?limit=30", { cache: "no-store" });
        const payload = await response.json() as EventsResponse;
        if (!response.ok) throw new Error(payload.error ?? "ACTIVITY_NOT_CONNECTED");
        if (active) { setEvents(payload.events ?? []); setError(null); setCheckedAt(new Date().toISOString()); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "ACTIVITY_UNAVAILABLE");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <section className="st-card st-panel" id="activity">
    <div className="st-panel-head"><div><h2>Recent activity</h2><p>Read-only worker events · refreshes every 15 seconds</p></div><span className="st-tag">{events.length} EVENTS</span></div>
    {error ? <div className="st-empty"><b>Activity feed not connected</b><p>{error}</p><small>Events will appear after the worker and shared database are running.</small></div> : events.length === 0 ? <div className="st-empty"><b>No recorded activity yet</b><p>The worker has not written any observation events to the shared database.</p></div> :
      <div className="st-event-list">{events.map(event => <article className="st-event" key={event.id}><span className="st-event-type">{event.event_type.replaceAll("_", " ")}</span><div className="st-event-copy"><b>{detail(event) || "Engine event"}</b><small>{new Date(event.created_at).toLocaleString()}</small></div></article>)}</div>}
    <p className="st-live-footnote">Last checked: {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "—"}. This feed is informational and has no trading controls.</p>
  </section>;
}
