import Link from "next/link";

const metrics = [
  { label: "Account balance", value: "—", note: "Waiting for broker connection" },
  { label: "Available cash", value: "—", note: "Not yet reconciled" },
  { label: "Today's P&L", value: "—", note: "No live account data" },
  { label: "Open positions", value: "0", note: "No positions loaded" },
];

const agents = [
  ["Chief Trading Agent", "Orchestration layer", "Awaiting connection"],
  ["Research Agent", "Market scanning", "Awaiting market data"],
  ["Small Trading Agent", "Strategy evaluation", "PAPER simulation only"],
  ["Position Monitor", "Stops and targets", "Awaiting price feed"],
  ["Risk Manager", "Deterministic safety checks", "Code module available"],
  ["Performance Agent", "P&L and reporting", "Awaiting broker ledger"],
];

export default function SmallTradingDashboard() {
  return (
    <main className="st-shell">
      <aside className="st-sidebar">
        <Link className="st-brand" href="/small-trading">
          <span className="st-mark">ST</span>
          <span><b>SMALL TRADING</b><small>AGENT PLATFORM</small></span>
        </Link>
        <div className="st-nav-label">WORKSPACE</div>
        <a className="st-nav active" href="#overview">▦ <span>Overview</span></a>
        <a className="st-nav" href="#agents">◎ <span>AI Agents</span></a>
        <a className="st-nav" href="#positions">▤ <span>Positions</span></a>
        <a className="st-nav" href="#activity">◷ <span>Activity</span></a>
        <div className="st-sidebar-bottom">
          <div className="st-mode"><i /> PAPER SIMULATOR</div>
          <p>Live trading is disabled in this build.</p>
          <Link href="/" className="st-back">← Existing command center</Link>
        </div>
      </aside>

      <section className="st-main" id="overview">
        <header className="st-topbar">
          <div><div className="st-eyebrow">TRADING OPERATIONS / OVERVIEW</div><h1>Small Trading Dashboard</h1></div>
          <div className="st-top-actions"><span className="st-status"><i /> SIMULATOR ONLY</span><span className="st-user">JL</span></div>
        </header>

        <section className="st-safety">
          <div className="st-safety-icon">!</div>
          <div><b>Paper environment — no real money is connected</b><p>Figures remain blank until a verified broker and market-data connection is configured. No orders can be submitted from this dashboard.</p></div>
          <span className="st-lock">LIVE LOCKED</span>
        </section>

        <div className="st-section-heading"><div><h2>Portfolio overview</h2><p>Account values will appear after broker connection and reconciliation.</p></div><span className="st-tag">DATA NOT CONNECTED</span></div>
        <section className="st-metrics">
          {metrics.map((metric) => <article className="st-card st-metric" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}
        </section>

        <div className="st-two-col">
          <section className="st-card st-panel" id="positions">
            <div className="st-panel-head"><div><h2>Open positions</h2><p>Broker-confirmed positions only</p></div><span className="st-count">0</span></div>
            <div className="st-empty"><div className="st-empty-icon">⌁</div><b>No positions to display</b><p>Positions will show here once a paper broker is connected and reconciled.</p></div>
          </section>
          <section className="st-card st-panel">
            <div className="st-panel-head"><div><h2>System health</h2><p>Latest worker heartbeat</p></div><span className="st-health-unknown">UNKNOWN</span></div>
            <div className="st-health-row"><span>Dashboard API</span><b>Foundation added</b></div>
            <div className="st-health-row"><span>Background worker</span><b className="st-muted">Not deployed</b></div>
            <div className="st-health-row"><span>Market data</span><b className="st-muted">Not connected</b></div>
            <div className="st-health-row"><span>Broker connection</span><b className="st-muted">Not connected</b></div>
            <div className="st-health-row"><span>Portfolio reconciliation</span><b className="st-muted">Not reconciled</b></div>
          </section>
        </div>

        <section className="st-card st-panel st-agents" id="agents">
          <div className="st-panel-head"><div><h2>Agent operations</h2><p>Six initial roles in the Small Trading architecture</p></div><span className="st-tag">FOUNDATION STAGE</span></div>
          <div className="st-agent-grid">
            {agents.map(([name, description, status], index) => <article className="st-agent" key={name}><span className="st-agent-number">0{index + 1}</span><div><b>{name}</b><p>{description}</p><small>{status}</small></div><i className="st-agent-dot" /></article>)}
          </div>
        </section>

        <section className="st-card st-panel" id="activity">
          <div className="st-panel-head"><div><h2>Recent activity</h2><p>Auditable events from the trading engine</p></div></div>
          <div className="st-empty st-activity-empty"><b>No activity recorded yet</b><p>Agent cycles, risk decisions and simulated fills will be listed here.</p></div>
        </section>
        <footer className="st-footer"><span>SMALL TRADING PLATFORM</span><span>BUILD STATUS: FOUNDATION · PAPER ONLY · LIVE DISABLED</span></footer>
      </section>
    </main>
  );
}
