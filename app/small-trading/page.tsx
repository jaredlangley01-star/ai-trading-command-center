"use client";
import { useState } from "react";
import Link from "next/link";
import LiveSystemStatus from "./live-system-status";
import BrokerReadOnlyPanel from "./broker-read-only-panel";
import ActivityFeed from "./activity-feed";
import MarketDataPanel from "./market-data-panel";
import AgentCommandCentre from "./agent-command-centre";
import AgentDirectory from "./agent-directory";
import DecisionHistory from "./decision-history";
import PerformancePanel from "./performance-panel";

type PageKey = "overview" | "agents" | "portfolio" | "performance" | "decisions" | "market" | "activity";
const navigation: { id: PageKey; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "agents", label: "AI Agents", icon: "◎" },
  { id: "portfolio", label: "My Portfolios", icon: "▤" },
  { id: "performance", label: "Performance", icon: "⌁" },
  { id: "decisions", label: "Decision Journal", icon: "▧" },
  { id: "market", label: "Market Data", icon: "▥" },
  { id: "activity", label: "Activity Log", icon: "◷" },
];
const pageTitles: Record<PageKey, { title: string; description: string }> = {
  overview: { title: "Overview", description: "Your trading command centre at a glance." },
  agents: { title: "AI Agents", description: "The agents, their responsibilities and their current operational status." },
  portfolio: { title: "My Portfolios", description: "Broker account, holdings, positions and orders." },
  performance: { title: "Performance", description: "Trading results and performance reporting." },
  decisions: { title: "Decision Journal", description: "Recorded strategy evaluations, signals and risk reasoning." },
  market: { title: "Market Data", description: "Market observations, broker session and data freshness." },
  activity: { title: "Activity Log", description: "Operational events recorded by the trading system." },
};
export default function SmallTradingDashboard() {
 const [page, setPage] = useState<PageKey>("overview");
 const current = pageTitles[page];
 return <main className="st-shell st-command-shell">
  <aside className="st-sidebar st-command-sidebar">
   <Link className="st-brand" href="/small-trading"><span className="st-mark">⌁</span><span><b>TRADING COMMAND CENTER</b><small>AI TRADING OPERATIONS</small></span></Link>
   <div className="st-workspace-switch"><span>SMALL TRADING</span><b>ST</b></div>
   <div className="st-sidebar-status"><span className="st-pulse"/><div><b>Paper environment active</b><small>Live trading is locked</small></div></div>
   <div className="st-nav-label">COMMAND CENTER</div>
   <nav className="st-command-nav" aria-label="Command centre pages">
    {navigation.map(item => <button key={item.id} type="button" className={"st-nav"+(page===item.id?" active":"")} aria-current={page===item.id?"page":undefined} onClick={()=>setPage(item.id)}><span className="st-nav-icon">{item.icon}</span><span>{item.label}</span></button>)}
   </nav>
   <div className="st-sidebar-bottom"><div className="st-paper-emblem">▱ <b>PAPER ONLY</b></div><p>No live orders · Read only</p></div>
  </aside>
  <section className="st-main st-command-main">
   {page === "overview" ? <>
    <AgentCommandCentre/>
    <header className="st-page-heading"><div><div className="st-eyebrow">TRADING OPERATIONS / OVERVIEW</div><h1>Financial Overview</h1><p>Broker-reported balances and essential system status, displayed in South African rand.</p></div><span className="st-status"><i/> PAPER ONLY</span></header>
    <section className="st-command-section"><BrokerReadOnlyPanel variant="summary"/></section>
    <section className="st-command-section"><LiveSystemStatus/></section>
   </> : <>
    <header className="st-page-heading"><div><div className="st-eyebrow">TRADING OPERATIONS / {current.title.toUpperCase()}</div><h1>{current.title}</h1><p>{current.description}</p></div><span className="st-status"><i/> PAPER ONLY</span></header>
    {page === "agents" && <AgentDirectory/>}
    {page === "portfolio" && <BrokerReadOnlyPanel variant="portfolio"/>}
    {page === "performance" && <PerformancePanel/>}
    {page === "decisions" && <DecisionHistory/>}
    {page === "market" && <MarketDataPanel/>}
    {page === "activity" && <ActivityFeed/>}
   </>}
   <footer className="st-footer"><span>AI TRADING COMMAND CENTER</span><span>SMALL TRADING · PAPER ONLY · LIVE DISABLED · CURRENCY ZAR</span></footer>
  </section>
 </main>;
}
