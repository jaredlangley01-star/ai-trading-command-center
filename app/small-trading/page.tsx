import Link from "next/link";
import LiveSystemStatus from "./live-system-status";
import BrokerReadOnlyPanel from "./broker-read-only-panel";
import ActivityFeed from "./activity-feed";
import MarketDataPanel from "./market-data-panel";
import AgentCommandCentre from "./agent-command-centre";
import DecisionHistory from "./decision-history";

export default function SmallTradingDashboard() {
  return <main className="st-shell">
    <aside className="st-sidebar">
      <Link className="st-brand" href="/small-trading"><span className="st-mark">ST</span><span><b>SMALL TRADING</b><small>AGENT PLATFORM</small></span></Link>
      <div className="st-nav-label">WORKSPACE</div>
      <a className="st-nav active" href="#overview">▦ <span>Overview</span></a>
      <a className="st-nav" href="#agents">◎ <span>AI Agents</span></a>
      <a className="st-nav" href="#positions">▤ <span>Positions</span></a>
      <a className="st-nav" href="#activity">◷ <span>Activity</span></a>
      <div className="st-sidebar-bottom"><div className="st-mode"><i /> PAPER ONLY</div><p>Live trading is disabled in this build.</p><Link href="/" className="st-back">← Existing command center</Link></div>
    </aside>
    <section className="st-main" id="overview">
      <header className="st-topbar"><div><div className="st-eyebrow">TRADING OPERATIONS / OVERVIEW</div><h1>Small Trading Dashboard</h1></div><div className="st-top-actions"><span className="st-status"><i /> PAPER ONLY</span><span className="st-user">JL</span></div></header>
      <section className="st-safety"><div className="st-safety-icon">!</div><div><b>Paper environment — live trading is locked</b><p>Account information is read directly from Alpaca Paper when configured. No order controls are available here.</p></div><span className="st-lock">LIVE LOCKED</span></section>
      <div className="st-two-col">
        <LiveSystemStatus />
        <section className="st-card st-panel"><div className="st-panel-head"><div><h2>Execution safety</h2><p>Current build permissions</p></div><span className="st-tag">READ ONLY</span></div>
          <div className="st-health-row"><span>Market data adapter</span><b>Alpaca IEX</b></div><div className="st-health-row"><span>Broker account reader</span><b>Paper API · GET only</b></div><div className="st-health-row"><span>Order submission</span><b className="st-muted">Not exposed</b></div><div className="st-health-row"><span>Live trading</span><b className="st-muted">Locked</b></div>
        </section>
      </div>
      <BrokerReadOnlyPanel />
      <MarketDataPanel />
      <AgentCommandCentre />
      <DecisionHistory />
      <ActivityFeed />
      <footer className="st-footer"><span>SMALL TRADING PLATFORM</span><span>FOUNDATION · PAPER ONLY · LIVE DISABLED</span></footer>
    </section>
  </main>;
}
