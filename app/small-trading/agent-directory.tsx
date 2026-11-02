"use client";
import { useEffect, useMemo, useState } from "react";

type Agent = { id: string; name: string; role: string; purpose: string; task: string };
type EventItem = { id: number; event_type: string; created_at: string; payload: Record<string, unknown> };
const agents: Agent[] = [
  { id: "chief_orchestrator", name: "Chief Trading Agent", role: "CORE TRADING INTELLIGENCE", purpose: "Coordinates the trading workforce and oversees the operation.", task: "Coordinating all agents" },
  { id: "research", name: "Research Agent", role: "MARKET INTELLIGENCE", purpose: "Checks market data source, quality and freshness before strategies are evaluated.", task: "Checking market data freshness" },
  { id: "small_trading", name: "Strategy Agent", role: "STRATEGY ANALYSIS", purpose: "Evaluates Trend Following, Momentum, Breakout and Mean Reversion signals.", task: "Evaluating strategy signals" },
  { id: "risk_manager", name: "Risk Manager", role: "CAPITAL PROTECTION", purpose: "Applies deterministic risk gates and blocks candidates when portfolio context or authorised limits are missing.", task: "Reviewing risk constraints" },
  { id: "position_monitor", name: "Position Monitor", role: "POSITION OVERSIGHT", purpose: "Monitors supported positions and records stop-loss or take-profit observations.", task: "Checking open positions" },
  { id: "performance_reporting", name: "Portfolio Agent", role: "REPORTING & INSIGHTS", purpose: "Summarises simulator results and read-only broker order activity.", task: "Preparing portfolio report" },
  { id: "marketing", name: "Trade Agent", role: "TRADE OPERATIONS", purpose: "Represents the trade workflow and its current execution restrictions.", task: "Standing by for authorised execution" },
];
const resting = (s: string) => ["RESTING", "IDLE", "SLEEPING", "BREAKROOM", "COMPLETE", "COMPLETED", "DONE", "BLOCKED"].includes(s);
function statusOf(events: EventItem[], id: string) {
  if (id === "chief_orchestrator") return "ALWAYS_ON";
  const event = events.find(e => e.event_type === "AGENT_ACTIVITY" && String(e.payload?.agent ?? "") === id);
  if (!event) return "WAITING";
  if (Date.now() - new Date(event.created_at).getTime() > 180000) return "STALE";
  return String(event.payload?.status ?? "UNKNOWN").toUpperCase();
}
export default function AgentDirectory() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/small-trading/events?limit=150", { cache: "no-store" });
        const data = await response.json() as { events?: EventItem[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "AGENT_ACTIVITY_UNAVAILABLE");
        if (active) { setEvents(data.events ?? []); setError(null); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "AGENT_ACTIVITY_UNAVAILABLE"); }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const rows = useMemo(() => agents.map(agent => {
    const status = statusOf(events, agent.id);
    const latest = events.find(e => e.event_type === "AGENT_ACTIVITY" && String(e.payload?.agent ?? "") === agent.id);
    return { ...agent, status, summary: String(latest?.payload?.summary ?? agent.task), lastSeen: latest?.created_at ?? null };
  }), [events]);
  const active = rows.filter(a => !resting(a.status));
  const restingAgents = rows.filter(a => resting(a.status));
  return <section className="st-agent-directory">
    <div className="st-panel-head"><div><h2>AI Agent Workforce</h2><p>Agent roles, responsibilities and live operational status. The solar-system visualisation stays on Overview.</p></div><span className="st-tag">{rows.length} AGENTS</span></div>
    {error && <div className="st-empty"><b>Agent activity unavailable</b><p>{error}</p></div>}
    <h3 className="st-subheading">Active & standby agents</h3>
    <div className="st-agent-directory-grid">{active.map(agent => <article className="st-agent-directory-card" key={agent.id}><div className="st-agent-directory-card-head"><span className="st-agent-avatar">{agent.name==="Chief Trading Agent"?"♛":"◎"}</span><span className={"st-agent-status status-"+agent.status.toLowerCase().replaceAll("_","-")}>{agent.status.replaceAll("_"," ")}</span></div><small>{agent.role}</small><h3>{agent.name}</h3><p>{agent.purpose}</p><div className="st-agent-task"><b>Current focus</b><span>{agent.summary}</span></div>{agent.lastSeen && <time>Last activity {new Date(agent.lastSeen).toLocaleString()}</time>}</article>)}</div>
    <div className="st-agent-rest-heading"><h3>Rest Mode</h3><span>{restingAgents.length} RESTING</span></div>
    {restingAgents.length ? <div className="st-agent-directory-grid">{restingAgents.map(agent => <article className="st-agent-directory-card is-resting" key={agent.id}><div className="st-agent-directory-card-head"><span className="st-agent-avatar">☾</span><span className="st-agent-status">{agent.status==="BLOCKED"?"BLOCKED · RESTING":"TASK COMPLETE · RESTING"}</span></div><small>{agent.role}</small><h3>{agent.name}</h3><p>{agent.purpose}</p><div className="st-agent-task"><b>Last recorded focus</b><span>{agent.summary}</span></div></article>)}</div> : <div className="st-empty">No agents are currently in Rest Mode.</div>}
    <p className="st-live-footnote">Completed and blocked agents are grouped under Rest Mode. They return to the active workforce when their status changes. The Chief Trading Agent remains always on. Paper trading only; live order execution remains locked.</p>
  </section>;
}
