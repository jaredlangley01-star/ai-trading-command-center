"use client";
import Link from "next/link";
import LiveSystemStatus from "./live-system-status";
import BrokerReadOnlyPanel from "./broker-read-only-panel";
import ActivityFeed from "./activity-feed";
import MarketDataPanel from "./market-data-panel";
import AgentCommandCentre from "./agent-command-centre";
import DecisionHistory from "./decision-history";
import PerformancePanel from "./performance-panel";
export default function SmallTradingDashboard() {
 return <main className="st-shell st-command-shell"><aside className="st-sidebar st-command-sidebar">
  <Link className="st-brand" href="/small-trading"><span className="st-mark">⌁</span><span><b>TRADING COMMAND CENTER</b><small>AI TRADING OPERATIONS</small></span></Link>
  <div className="st-workspace-switch"><span>SMALL TRADING</span><b>ST</b></div><div className="st-sidebar-status"><span className="st-pulse"/><div><b>Paper environment active</b><small>Live trading is locked</small></div></div>
  <div className="st-nav-label">COMMAND CENTER</div><a className="st-nav active" href="#overview">⌂ <span>Overview</span></a><a className="st-nav" href="#agents">◎ <span>AI Agents</span></a><a className="st-nav" href="#portfolio">▤ <span>Portfolio & Positions</span></a><a className="st-nav" href="#performance">⌁ <span>Performance</span></a><a className="st-nav" href="#decisions">▧ <span>Decision Journal</span></a><a className="st-nav" href="#market">▥ <span>Market Data</span></a><a className="st-nav" href="#activity">◷ <span>Activity Log</span></a>
  <div className="st-sidebar-network"><div className="st-nav-label">AGENT NETWORK</div>{["Chief Trading Agent","Research Agent","Small Trading Agent","Risk Manager","Position Monitor","Performance Agent"].map((name,i)=><div className="st-network-agent" key={name}><i className={i===3?"is-amber":""}/><span>{name}</span><small>{i===3?"GATED":"ONLINE"}</small></div>)}</div>
  <div className="st-sidebar-bottom"><div className="st-paper-emblem">▱ <b>PAPER ONLY</b></div><p>No live orders · Read only</p><Link href="/" className="st-back">← Existing command center</Link></div>
 </aside><section className="st-main st-command-main" id="overview">
  <header className="st-topbar st-command-topbar"><div><div className="st-eyebrow">TRADING OPERATIONS / SMALL TRADING</div><h1>AI Trading Command Center</h1><p className="st-header-subtitle">Your trading workforce, working together.</p></div><div className="st-top-actions"><span className="st-status"><i/> PAPER ONLY</span><span className="st-user">JL</span></div></header>
  <section className="st-command-hero"><div className="st-hero-copy"><span className="st-hero-kicker">THE ORCHESTRATED WORKFORCE</span><h2>One command center.<br/><em>Every agent in sync.</em></h2><p>The Chief Trading Agent coordinates research, strategy, risk checks and portfolio monitoring. Select any workstation to inspect its activity and responsibilities.</p><div className="st-hero-pills"><span><i/> Paper environment</span><span>Live execution locked</span><span>Auto-refreshing activity</span></div></div><div className="st-chief-feature"><div className="st-chief-glow">⌁</div><div><span className="st-chief-crown">★ MAIN ORCHESTRATOR</span><h3>Chief Trading Agent</h3><p>Coordinates the entire Small Trading operation.</p><a href="#agents">Inspect agent network <b>↗</b></a></div></div></section>
  <section className="st-safety st-command-safety"><div className="st-safety-icon">!</div><div><b>Paper environment — live trading is locked</b><p>Broker information is read-only. No order submission, amendment or cancellation controls are available.</p></div><span className="st-lock">LIVE LOCKED</span></section>
  <section className="st-command-section" id="agents"><div className="st-section-heading"><div><h2>Trading Solar System</h2><p>Your Chief Trading Agent stays at the centre while specialist agents work around it. Select an agent to inspect its activity.</p></div><span className="st-tag">6 ROLES · AUTO REFRESH</span></div><AgentCommandCentre/></section>
  <section className="st-command-section" id="portfolio"><div className="st-section-heading"><div><h2>Portfolio & Account</h2><p>Broker-reported values and open positions. Read-only.</p></div></div><BrokerReadOnlyPanel/></section>
  <section className="st-command-section" id="market"><div className="st-section-heading"><div><h2>Market Intelligence</h2><p>Market session, IEX observations and freshness diagnostics.</p></div></div><MarketDataPanel/></section>
  <section className="st-command-section" id="decisions"><DecisionHistory/></section><section className="st-command-section" id="performance"><PerformancePanel/></section><section className="st-command-section" id="activity"><ActivityFeed/></section><section className="st-command-section"><LiveSystemStatus/></section>
  <footer className="st-footer"><span>AI TRADING COMMAND CENTER</span><span>SMALL TRADING · PAPER ONLY · LIVE DISABLED</span></footer>
 </section></main>;
}