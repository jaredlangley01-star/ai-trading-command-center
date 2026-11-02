"use client";
import { useEffect, useMemo, useState } from "react";

type EventItem = { id: number; event_type: string; created_at: string; payload: Record<string, unknown> };
type Agent = { id: string; name: string; purpose: string; implementation: string };
const agents: Agent[] = [
  { id: "chief_orchestrator", name: "Chief Trading Agent", purpose: "Coordinates each market scan and records its outcome.", implementation: "Active orchestration" },
  { id: "research", name: "Research Agent", purpose: "Checks market data availability and freshness.", implementation: "Active data validation" },
  { id: "small_trading", name: "Small Trading Agent", purpose: "Evaluates Trend, Momentum, Breakout and Mean Reversion.", implementation: "Active baseline strategies" },
  { id: "risk_manager", name: "Risk Manager", purpose: "Applies deterministic limits before a trade can be considered.", implementation: "Risk module built; not yet in the recurring worker cycle" },
  { id: "position_monitor", name: "Position Monitor", purpose: "Checks stop-loss, take-profit and end-of-day conditions.", implementation: "Simulator lifecycle built; not yet connected to a live quote loop" },
  { id: "performance_reporting", name: "Performance Agent", purpose: "Summarises account performance and trading outcomes.", implementation: "Role scaffold; broker reporting workflow not yet active" },
];
function eventSummary(event: EventItem) {
  const p = event.payload ?? {};
  return {
    agent: String(p.agent ?? ""), status: String(p.status ?? "UNKNOWN"),
    phase: String(p.phase ?? "ACTIVITY"), symbol: String(p.symbol ?? ""),
    summary: String(p.summary ?? "Agent activity recorded"), createdAt: event.created_at,
    details: p.details && typeof p.details === "object" ? p.details as Record<string, unknown> : {},
  };
}
export default function AgentCommandCentre() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("all");
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/small-trading/events?limit=100", { cache: "no-store" });
        const payload = await response.json() as { events?: EventItem[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "AGENT_ACTIVITY_UNAVAILABLE");
        if (active) { setEvents(payload.events ?? []); setError(null); setCheckedAt(new Date().toISOString()); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "AGENT_ACTIVITY_UNAVAILABLE");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const activity = useMemo(() => events.filter(e => e.event_type === "AGENT_ACTIVITY").map(eventSummary), [events]);
  const latest = (id: string) => activity.find(item => item.agent === id);
  const timeline = events.filter(e => e.event_type === "AGENT_ACTIVITY" && (agentFilter === "all" || String(e.payload?.agent ?? "") === agentFilter)).slice(0, 30);
  return <section className="st-card st-panel" id="agents">
    <div className="st-panel-head"><div><h2>Agent Command Centre</h2><p>Recorded agent steps, outcomes and roles not active yet.</p></div><span className="st-tag">AUTO REFRESH · 5 SEC</span></div>
    {error ? <div className="st-empty"><b>Agent activity is not connected</b><p>{error}</p><small>Connect the dashboard to the running worker to see real events.</small></div> :
      <div className="st-agent-grid">{agents.map((agent, index) => {
        const last = latest(agent.id);
        const activeRole = agent.id === "chief_orchestrator" || agent.id === "research" || agent.id === "small_trading";
        const status = last ? last.status : activeRole ? "NO ACTIVITY YET" : "STANDBY";
        const statusClass = status === "ERROR" || status === "BLOCKED" ? "is-warning" : status === "WORKING" ? "is-working" : status === "COMPLETED" || status === "READY" ? "is-ok" : "";
        return <article className="st-agent st-agent-live" key={agent.id}>
          <span className="st-agent-number">0{index + 1}</span>
          <div className="st-agent-live-copy"><b>{agent.name}</b><p>{agent.purpose}</p>
            <span className={"st-agent-state " + statusClass}>{status.replaceAll("_", " ")}</span>
            <small>{last ? last.summary + (last.symbol ? " · " + last.symbol : "") : agent.implementation}</small>
            {last && <small className="st-agent-time">Last event: {new Date(last.createdAt).toLocaleString()}</small>}
            {last && Array.isArray(last.details.signals) && <div className="st-agent-signals">{(last.details.signals as Array<Record<string, unknown>>).map((signal, i) => <span key={i}>{String(signal.strategy)}: {String(signal.status)} · {String(signal.reason ?? "")}</span>)}</div>}
          </div><i className={"st-agent-dot " + (statusClass || "is-idle")} />
        </article>;
      })}</div>}
    {!error && <div className="st-agent-timeline">
      <div className="st-agent-timeline-head"><div><h3>Agent activity timeline</h3><p>Latest recorded steps, newest first</p></div>
        <select aria-label="Filter agent activity" value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="all">All agents</option>
          {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </div>
      {timeline.length === 0 ? <div className="st-agent-timeline-empty">No agent events have been recorded yet. Once the worker runs, each step will appear here.</div> :
        <ol className="st-agent-timeline-list">{timeline.map(event => {
          const item = eventSummary(event);
          const role = agents.find(agent => agent.id === item.agent);
          return <li key={event.id}><span className={"st-agent-timeline-marker " + (item.status === "ERROR" || item.status === "BLOCKED" ? "is-warning" : item.status === "WORKING" ? "is-working" : "is-ok")} />
            <div className="st-agent-timeline-content">
              <div className="st-agent-timeline-title"><b>{role?.name ?? item.agent}</b><span>{item.phase.replaceAll("_", " ")}</span></div>
              <p>{item.summary}{item.symbol ? " · " + item.symbol : ""}</p>
              <small>{new Date(item.createdAt).toLocaleString()} · {item.status.replaceAll("_", " ")}</small>
              {Array.isArray(item.details.signals) && <div className="st-agent-signals">{(item.details.signals as Array<Record<string, unknown>>).map((signal, i) => <span key={i}>{String(signal.strategy)}: {String(signal.status)} · score {String(signal.score ?? "—")}</span>)}</div>}
            </div></li>;
        })}</ol>}
    </div>}
    <div className="st-agent-disclaimer">Transparency note: only steps written to the audit log appear here. The first three roles currently run during observation scans. Risk approval, position monitoring and performance reporting are not yet connected to the recurring worker. These are deterministic software roles, not independent LLM agents. No orders are submitted.</div>
    <div className="st-live-footnote">Latest activity checked: {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "—"}. An empty state does not mean an agent is working.</div>
  </section>;
}
