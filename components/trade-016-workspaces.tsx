"use client";
import { useCallback, useEffect, useState } from "react";
import { ProfessionalMarketDashboard } from "./professional-market-dashboard";

type Check = {
  name: string;
  state: string;
  detail: string;
  lastHealthy: string | null;
};
type DiagnosticPayload = {
  summary: string;
  checks: Check[];
  paperReady: boolean;
  liveReady: boolean;
  liveLocked: boolean;
  schemaVersion: string | null;
  expectedMigration: string;
  nonTrading: boolean;
};

export function DiagnosticsWorkspace() {
  const [data, setData] = useState<DiagnosticPayload | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState("");
  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/diagnostics", { cache: "no-store" });
      if (!response.ok) throw new Error("SYSTEM_CHECK_FAILED");
      setData(await response.json());
    } catch {
      setError("The non-trading system check could not complete.");
    } finally {
      setRunning(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(run, 0);
    return () => window.clearTimeout(initial);
  }, [run]);
  return (
    <div className="diagnostics-workspace">
      <section className="module diagnostics-hero">
        <header className="module-head">
          <div>
            <span className="section-label">
              PRODUCTION READINESS · NON-TRADING CHECKS
            </span>
            <h2>{data?.summary ?? "CHECKING"}</h2>
          </div>
          <button
            className="button primary"
            disabled={running}
            onClick={() => void run()}
          >
            {running ? "RUNNING…" : "RUN SYSTEM CHECK"}
          </button>
        </header>
        <p>
          This check reads configuration, schema, and health signals only. It
          cannot place or cancel orders, change risk settings, resume
          automation, or enable LIVE.
        </p>
        <div className="readiness-pills">
          <b className={data?.paperReady ? "ready" : "warn"}>
            PAPER {data?.paperReady ? "READY" : "NOT READY"}
          </b>
          <b className="locked">
            LIVE {data?.liveReady ? "READY" : "NOT CONFIGURED"} ·{" "}
            {data?.liveLocked ? "LOCKED" : "SERVER GATE ENABLED"}
          </b>
        </div>
        {error && <div className="broker-error">{error}</div>}
      </section>
      <section className="module diagnostic-grid">
        {(data?.checks ?? []).map((check) => (
          <article key={check.name}>
            <div>
              <strong>{check.name}</strong>
              <span
                className={`status-badge ${check.state.toLowerCase().replaceAll(" ", "-")}`}
              >
                {check.state}
              </span>
            </div>
            <p>{check.detail}</p>
            <small>
              LAST HEALTHY ·{" "}
              {check.lastHealthy
                ? new Date(check.lastHealthy).toLocaleString()
                : "NOT RECORDED"}
            </small>
          </article>
        ))}
      </section>
      <section className="module readiness-checklist">
        <header className="module-head">
          <div>
            <span className="section-label">OWNER READINESS CHECKLIST</span>
            <h2>Final hosted validation</h2>
          </div>
        </header>
        {[
          "Trading Worker Online",
          "Notification Worker Online",
          "Database Connected",
          "Market Data Connected",
          "PAPER Broker Connected",
          "Risk Settings Reviewed",
          "Emergency Stop Tested",
          "Push Notification Tested",
          "Backtest Completed",
          "Auto Trader Settings Reviewed",
          "Position Protection Healthy",
          "LIVE Credentials Configured",
          "LIVE Risk Limits Configured",
          "LIVE Still Locked",
        ].map((item) => (
          <label key={item}>
            <input type="checkbox" /> {item}
          </label>
        ))}
        <p>
          Checklist acknowledgements are operational reminders; live health
          remains authoritative above.
        </p>
      </section>
    </div>
  );
}

export function EnvironmentSettingsWorkspace() {
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState("LIVE READY — LOCKED");
  return (
    <section className="module environment-settings">
      <header className="module-head">
        <div>
          <span className="section-label">TRADING ENVIRONMENT</span>
          <h2>PAPER active · LIVE ready and locked</h2>
        </div>
        <span className="status-badge locked">LIVE LOCKED</span>
      </header>
      <p>
        PAPER and LIVE use separate accounts, credentials, endpoints, risk
        limits, positions, orders, and audit attribution. LIVE Auto Trader is
        OFF by default.
      </p>
      <div
        className="environment-selector"
        role="group"
        aria-label="Trading environment"
      >
        <button className="button primary">PAPER · ACTIVE</button>
        <button className="button" disabled>
          LIVE · LOCKED
        </button>
      </div>
      <label>
        LIVE ACTIVATION PHRASE
        <input
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder="ENABLE LIVE TRADING"
        />
      </label>
      <button
        className="button danger"
        onClick={() =>
          setMessage(
            phrase === "ENABLE LIVE TRADING"
              ? "LIVE_TRADING_LOCKED — the server enablement gate remains false."
              : "LIVE_CONFIRMATION_REQUIRED",
          )
        }
      >
        REQUEST LIVE ACTIVATION
      </button>
      <div className="ticket-state">
        <b>RESULT</b>
        <span>{message}</span>
      </div>
      <small>
        A typed phrase alone is never sufficient. Credentials, broker, database,
        workers, market data, risk health, diagnostics, and safe order
        transition must all pass server-side.
      </small>
    </section>
  );
}

const frames = [
  "1Min",
  "5Min",
  "15Min",
  "30Min",
  "1Hour",
  "4Hour",
  "1Day",
  "1Week",
];
const tools = [
  "TREND_LINE",
  "HORIZONTAL_LINE",
  "VERTICAL_LINE",
  "RECTANGLE",
  "TEXT",
  "PRICE_MARKER",
  "RAY",
  "FIBONACCI",
];
export function AdvancedChartsWorkspace() {
  const [symbol, setSymbol] = useState("SPY"),
    [timeframe, setTimeframe] = useState("15Min"),
    [tool, setTool] = useState("TREND_LINE"),
    [drawings, setDrawings] = useState<
      Array<{ id: string; drawing_type: string; label: string }>
    >([]),
    [watchlist, setWatchlist] = useState([
      "SPY",
      "QQQ",
      "AAPL",
      "MSFT",
      "NVDA",
    ]),
    [newSymbol, setNewSymbol] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(
      `/api/charts?symbol=${symbol}&timeframe=${timeframe}`,
      { cache: "no-store" },
    );
    if (response.ok) {
      const payload = await response.json();
      setDrawings(payload.drawings);
      setWatchlist(payload.preferences.watchlist);
    }
  }, [symbol, timeframe]);
  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    return () => window.clearTimeout(initial);
  }, [load]);
  const savePreferences = async (next: string[]) => {
    setWatchlist(next);
    await fetch("/api/charts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preferences: {
          watchlist: next,
          indicators: [
            { type: "SMA", period: 20 },
            { type: "EMA", period: 12 },
            { type: "RSI", period: 14 },
            { type: "MACD", fast: 12, slow: 26, signal: 9 },
            { type: "VOLUME" },
          ],
          overlaySettings: {
            positions: true,
            orders: true,
            closedTrades: false,
          },
        },
      }),
    });
  };
  const addDrawing = async () => {
    await fetch("/api/charts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol,
        timeframe,
        drawing: {
          type: tool,
          label: `${tool.replaceAll("_", " ")} · ${new Date().toLocaleTimeString()}`,
          geometry: { pendingPlacement: true },
          style: { environment: "PAPER" },
        },
      }),
    });
    await load();
  };
  return (
    <div className="charts-workspace">
      <section className="module chart-command">
        <header className="module-head">
          <div>
            <span className="section-label">
              ADVANCED CHARTS · ALPACA IEX · PAPER
            </span>
            <h2>{symbol} market workspace</h2>
          </div>
          <button className="button">EXPAND CHART</button>
        </header>
        <div className="chart-command-row">
          <input
            aria-label="Chart symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
          >
            {frames.map((frame) => (
              <option key={frame}>{frame}</option>
            ))}
          </select>
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            {tools.map((item) => (
              <option key={item}>{item.replaceAll("_", " ")}</option>
            ))}
          </select>
          <button className="button primary" onClick={() => void addDrawing()}>
            ADD MARK
          </button>
          <button
            className="button"
            onClick={() =>
              void fetch("/api/charts", {
                method: "DELETE",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ symbol, timeframe }),
              }).then(load)
            }
          >
            CLEAR
          </button>
        </div>
        <div className="indicator-strip">
          <b>SMA 20</b>
          <b>EMA 12</b>
          <b>RSI 14</b>
          <b>MACD 12/26/9</b>
          <b>VOLUME</b>
          <span>Signal scores are not probability of profit.</span>
        </div>
      </section>
      <ProfessionalMarketDashboard positions={[]} portfolioValue={0} />
      <div className="chart-side-grid">
        <section className="module">
          <header className="module-head">
            <div>
              <span className="section-label">PERSISTED DRAWINGS</span>
              <h2>
                {symbol} · {timeframe}
              </h2>
            </div>
          </header>
          {drawings.length ? (
            drawings.map((drawing) => (
              <div className="drawing-row" key={drawing.id}>
                <span>{drawing.drawing_type.replaceAll("_", " ")}</span>
                <small>{drawing.label}</small>
                <button
                  onClick={() =>
                    void fetch("/api/charts", {
                      method: "DELETE",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ id: drawing.id }),
                    }).then(load)
                  }
                >
                  DELETE
                </button>
              </div>
            ))
          ) : (
            <p>No saved markings for this symbol and timeframe.</p>
          )}
        </section>
        <section className="module">
          <header className="module-head">
            <div>
              <span className="section-label">CHART WATCHLIST</span>
              <h2>Owner symbols</h2>
            </div>
          </header>
          <div className="watchlist-add">
            <input
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              placeholder="Add symbol"
            />
            <button
              className="button"
              onClick={() => {
                if (
                  /^[A-Z.]{1,10}$/.test(newSymbol) &&
                  !watchlist.includes(newSymbol)
                )
                  void savePreferences([...watchlist, newSymbol]);
                setNewSymbol("");
              }}
            >
              ADD
            </button>
          </div>
          {watchlist.map((item) => (
            <div className="drawing-row" key={item}>
              <button onClick={() => setSymbol(item)}>{item}</button>
              <small>ALPACA IEX · freshness shown on chart</small>
              <button
                onClick={() =>
                  void savePreferences(
                    watchlist.filter((value) => value !== item),
                  )
                }
              >
                REMOVE
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
