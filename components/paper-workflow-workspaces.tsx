"use client";
import { useEffect, useMemo, useState } from "react";
import {
  activeTradeSummary,
  classifyTradeOrigin,
  journalSummary,
} from "@/src/services/paper-workflow";

type Row = Record<string, string | number | null>;
export type PaperPortfolio = {
  source: "ALPACA_PAPER" | "NO_SYNC_DATA";
  account: null | Record<string, string | number | null>;
  positions: Row[];
  orders: Row[];
  fills: Row[];
  history: Row[];
  journal: Row[];
  activity: Array<{
    id: string;
    action: string;
    metadata: Row;
    created_at: string;
  }>;
};

const money = (value: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
const signed = (value: unknown) => {
  const amount = Number(value ?? 0);
  return `${amount > 0 ? "+" : ""}${money(amount)}`;
};

export function ActiveTradeHeader({ positions }: { positions: Row[] }) {
  const summary = activeTradeSummary(positions);
  return (
    <div className="active-trade-header" data-tutorial="active-trades">
      <span>
        ACTIVE TRADES <b>{summary.active}</b>
      </span>
      {summary.active > 0 && (
        <span>
          BIG <b>{summary.big}</b> · SMALL <b>{summary.small}</b>
          {summary.standard ? (
            <>
              {" "}
              · STANDARD <b>{summary.standard}</b>
            </>
          ) : null}
        </span>
      )}
      <span>
        CAPITAL IN MARKET <b>{money(summary.capital)}</b>
      </span>
      <span className={summary.openPl >= 0 ? "positive" : "negative"}>
        OPEN P/L <b>{signed(summary.openPl)}</b>
      </span>
    </div>
  );
}

export function PortfolioWorkspace({
  portfolio,
  openPosition,
}: {
  portfolio: PaperPortfolio;
  openPosition: (position: Row) => void;
}) {
  const account = portfolio.account;
  return (
    <div className="workspace-page portfolio-workspace">
      <section className="module portfolio-account-grid">
        {[
          ["ACCOUNT EQUITY", account?.equity],
          ["CASH", account?.cash],
          ["BUYING POWER", account?.buying_power],
          ["OPEN EXPOSURE", account?.open_exposure],
          ["UNREALIZED P/L", account?.unrealized_pl],
          ["REALIZED P/L TODAY", account?.realized_pl_today],
        ].map(([label, value]) => (
          <div className="financial-metric" key={String(label)}>
            <span>{label}</span>
            <b>{money(value)}</b>
            <small>ALPACA PAPER · synchronized</small>
          </div>
        ))}
      </section>
      <WorkflowTable
        title="OPEN POSITIONS"
        empty="NO ACTIVE TRADES — When a PAPER trade opens, it will appear here."
        headings={[
          "SYMBOL",
          "CLASS",
          "SIDE",
          "QTY",
          "ENTRY",
          "CURRENT",
          "VALUE",
          "P/L",
          "P/L %",
          "STOP",
          "TARGET",
          "STRATEGY",
          "ORIGIN",
          "OPENED",
          "STATUS",
        ]}
        rows={portfolio.positions.map((position) => [
          String(position.symbol),
          classifyTradeOrigin(position.trade_origin),
          String(position.side),
          String(position.quantity),
          money(position.entry_price),
          money(position.current_price),
          money(position.market_value),
          signed(position.unrealized_pl),
          `${Number(position.unrealized_pl_pct ?? 0).toFixed(2)}%`,
          position.stop_loss == null ? "—" : money(position.stop_loss),
          position.take_profit == null ? "—" : money(position.take_profit),
          String(position.strategy_name ?? "Unattributed"),
          String(position.trade_origin ?? "STANDARD").replaceAll("_", " "),
          position.opened_at
            ? new Date(String(position.opened_at)).toLocaleString()
            : "—",
          String(position.status),
        ])}
        onRow={(index) => openPosition(portfolio.positions[index])}
      />
      <WorkflowTable
        title="PENDING / OPEN ORDERS"
        empty="NO OPEN PAPER ORDERS"
        headings={[
          "SYMBOL",
          "SIDE",
          "TYPE",
          "QTY",
          "STATUS",
          "ORIGIN",
          "CREATED",
        ]}
        rows={portfolio.orders.map((order) => [
          String(order.symbol),
          String(order.direction),
          String(order.order_type),
          String(order.quantity),
          String(order.status),
          String(order.source ?? "STANDARD").replaceAll("_", " "),
          new Date(String(order.created_at)).toLocaleString(),
        ])}
      />
      <WorkflowTable
        title="RECENT FILLS"
        empty="NO PAPER FILLS YET"
        headings={["SYMBOL", "SIDE", "QTY", "PRICE", "STRATEGY", "TIME"]}
        rows={portfolio.fills.map((fill) => [
          String(fill.symbol),
          String(fill.side),
          String(fill.quantity),
          money(fill.price),
          String(fill.strategy_name ?? "Unattributed"),
          new Date(String(fill.executed_at)).toLocaleString(),
        ])}
      />
    </div>
  );
}

function WorkflowTable({
  title,
  empty,
  headings,
  rows,
  onRow,
}: {
  title: string;
  empty: string;
  headings: string[];
  rows: string[][];
  onRow?: (index: number) => void;
}) {
  return (
    <section className="module workflow-table">
      <header className="module-head">
        <div>
          <span className="section-label">{title}</span>
        </div>
      </header>
      <div className="table-scroll">
        <table className="position-table">
          <thead>
            <tr>
              {headings.map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${title}-${index}`}
                tabIndex={onRow ? 0 : undefined}
                onClick={() => onRow?.(index)}
              >
                {row.map((value, cell) => (
                  <td key={cell}>{value}</td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="table-empty" colSpan={headings.length}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TradeJournalWorkspace() {
  const [trades, setTrades] = useState<Row[]>([]),
    [filters, setFilters] = useState({
      from: "",
      symbol: "",
      classification: "",
      strategy: "",
      result: "",
      origin: "",
      exitReason: "",
    }),
    [error, setError] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    );
    void fetch(`/api/journal?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setTrades(data.trades ?? []);
      })
      .catch(() => setError("Completed PAPER trade history is unavailable."));
  }, [filters]);
  const summary = journalSummary(trades);
  return (
    <div className="workspace-page journal-workspace">
      <section className="module journal-summary">
        {[
          ["COMPLETED", summary.completed],
          ["WINS", summary.wins],
          ["LOSSES", summary.losses],
          ["WIN RATE", `${summary.winRate.toFixed(1)}%`],
          ["REALIZED P/L", signed(summary.totalRealizedPl)],
          ["AVERAGE WIN", money(summary.averageWin)],
          ["AVERAGE LOSS", money(summary.averageLoss)],
          ["LARGEST WIN", money(summary.largestWin)],
          ["LARGEST LOSS", money(summary.largestLoss)],
        ].map(([label, value]) => (
          <div className="financial-metric" key={String(label)}>
            <span>{label}</span>
            <b>{value}</b>
            <small>
              {summary.completed
                ? "Actual completed PAPER trades"
                : "NOT ENOUGH DATA YET"}
            </small>
          </div>
        ))}
      </section>
      <section className="module journal-filters">
        <input
          aria-label="Journal from date"
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        />
        <input
          aria-label="Journal symbol"
          placeholder="Symbol"
          value={filters.symbol}
          onChange={(e) =>
            setFilters({ ...filters, symbol: e.target.value.toUpperCase() })
          }
        />
        <select
          aria-label="Journal classification"
          value={filters.classification}
          onChange={(e) =>
            setFilters({ ...filters, classification: e.target.value })
          }
        >
          <option value="">ALL SIZES</option>
          <option>BIG</option>
          <option>SMALL</option>
          <option>STANDARD</option>
        </select>
        <input
          aria-label="Journal strategy"
          placeholder="Strategy"
          value={filters.strategy}
          onChange={(e) => setFilters({ ...filters, strategy: e.target.value })}
        />
        <select
          aria-label="Journal result"
          value={filters.result}
          onChange={(e) => setFilters({ ...filters, result: e.target.value })}
        >
          <option value="">WIN + LOSS</option>
          <option>WIN</option>
          <option>LOSS</option>
        </select>
        <select
          aria-label="Journal origin"
          value={filters.origin}
          onChange={(e) => setFilters({ ...filters, origin: e.target.value })}
        >
          <option value="">ALL ORIGINS</option>
          <option value="AUTO_TRADER">AUTO TRADER</option>
          <option value="BIG_MONEY">BIG MONEY</option>
          <option value="MANUAL">MANUAL</option>
        </select>
        <input
          aria-label="Journal exit reason"
          placeholder="Exit reason"
          value={filters.exitReason}
          onChange={(e) =>
            setFilters({ ...filters, exitReason: e.target.value.toUpperCase() })
          }
        />
      </section>
      {error && <div className="broker-error">{error}</div>}
      <WorkflowTable
        title="COMPLETED PAPER TRADES"
        empty="NO COMPLETED TRADES YET"
        headings={[
          "SYMBOL",
          "CLASS / ORIGIN",
          "STRATEGY",
          "SIDE",
          "QTY",
          "ENTRY",
          "EXIT",
          "GROSS P/L",
          "COSTS",
          "NET P/L",
          "RETURN",
          "DURATION",
          "ENTRY REASON",
          "EXIT REASON",
          "STOP / TARGET",
          "RISK DECISION",
          "ENVIRONMENT",
        ]}
        rows={trades.map((trade) => {
          const duration =
            Date.parse(String(trade.exit_timestamp)) -
            Date.parse(String(trade.entry_timestamp));
          return [
            String(trade.symbol),
            `${trade.classification} · ${String(trade.trade_origin).replaceAll("_", " ")}`,
            String(trade.strategy_name ?? "Unattributed"),
            String(trade.direction),
            String(trade.quantity),
            `${money(trade.entry_price)} · ${new Date(String(trade.entry_timestamp)).toLocaleString()}`,
            `${money(trade.exit_price)} · ${new Date(String(trade.exit_timestamp)).toLocaleString()}`,
            signed(trade.gross_pl),
            money(trade.costs),
            signed(trade.net_pl),
            `${Number(trade.return_pct).toFixed(2)}%`,
            `${Math.max(0, Math.round(duration / 60000))}m`,
            String(trade.entry_reason ?? "—"),
            String(trade.exit_reason ?? "BROKER POSITION CLOSED"),
            `${trade.stop_loss == null ? "—" : money(trade.stop_loss)} / ${trade.take_profit == null ? "—" : money(trade.take_profit)}`,
            String(trade.risk_decision ?? "PAPER RISK CONTROLS APPLIED"),
            String(trade.environment ?? "PAPER"),
          ];
        })}
      />
    </div>
  );
}

const productionStrategies = [
  "Momentum",
  "Breakout",
  "Trend Following",
  "Mean Reversion",
  "Combined Opportunity Engine",
];
export function StrategyPerformanceWorkspace({
  openBacktesting,
}: {
  openBacktesting: () => void;
}) {
  const [data, setData] = useState<{
      autoTrader?: {
        enabled: boolean;
        allowed_strategies: string[];
        minimum_strategy_score?: number;
        maximum_trade_size?: number;
        maximum_risk_per_trade?: number;
        maximum_concurrent_positions?: number;
      };
      signals: Row[];
      performance: Record<string, ReturnType<typeof journalSummary>>;
      trades: Row[];
      backtests: Row[];
    } | null>(null),
    [selected, setSelected] = useState(productionStrategies[0]),
    [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/strategy/performance")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setData(payload);
      })
      .catch(() => setError("Strategy performance is currently unavailable."));
  }, []);
  const signals = useMemo(
    () =>
      (data?.signals ?? []).filter(
        (signal) => String(signal.strategy_name) === selected,
      ),
    [data, selected],
  );
  const backtest = (data?.backtests ?? []).find(
    (item) => String(item.strategy_name) === selected,
  );
  const backtestMetrics = (backtest?.metrics ?? {}) as Record<string, number>;
  const recentTrades = (data?.trades ?? []).filter(
    (trade) => String(trade.strategy_name) === selected,
  );
  return (
    <div className="workspace-page strategy-performance-workspace">
      {error && <div className="broker-error">{error}</div>}
      <section className="module strategy-list">
        <header className="module-head">
          <div>
            <span className="section-label">PRODUCTION STRATEGIES</span>
          </div>
        </header>
        {productionStrategies.map((name) => {
          const stats = data?.performance?.[name];
          const allowed =
            data?.autoTrader?.allowed_strategies?.includes(name) ||
            name === "Combined Opportunity Engine";
          return (
            <button
              className={`strategy-row ${selected === name ? "active" : ""}`}
              key={name}
              onClick={() => setSelected(name)}
            >
              <div>
                <b>{name}</b>
                <small>
                  {allowed
                    ? "USED BY AUTO TRADER"
                    : "NOT CURRENTLY AUTO-ELIGIBLE"}
                </small>
              </div>
              <span className="status-badge">
                {data?.autoTrader?.enabled && allowed ? "ENABLED" : "DISABLED"}
              </span>
              <strong>
                {stats ? `${stats.winRate.toFixed(1)}%` : "—"}
                <small> WIN RATE</small>
              </strong>
            </button>
          );
        })}
      </section>
      <section className="module strategy-detail">
        <header className="module-head">
          <div>
            <span className="section-label">STRATEGY DETAIL</span>
            <h2>{selected}</h2>
          </div>
        </header>
        <p>{strategyExplanation(selected)}</p>
        <div className="strategy-config-strip">
          <span>
            SUPPORTED REGIME <b>{strategyRegime(selected)}</b>
          </span>
          <span>
            MINIMUM SCORE{" "}
            <b>{data?.autoTrader?.minimum_strategy_score ?? "—"}</b>
          </span>
          <span>
            MAX TRADE <b>{money(data?.autoTrader?.maximum_trade_size)}</b>
          </span>
          <span>
            MAX RISK/TRADE{" "}
            <b>{money(data?.autoTrader?.maximum_risk_per_trade)}</b>
          </span>
          <span>
            CONCURRENT LIMIT{" "}
            <b>{data?.autoTrader?.maximum_concurrent_positions ?? "—"}</b>
          </span>
        </div>
        <div className="strategy-stat-grid">
          {[
            ["SIGNALS", signals.length],
            ["COMPLETED", data?.performance?.[selected]?.completed ?? 0],
            ["WINS", data?.performance?.[selected]?.wins ?? 0],
            ["LOSSES", data?.performance?.[selected]?.losses ?? 0],
            [
              "REALIZED P/L",
              signed(data?.performance?.[selected]?.totalRealizedPl ?? 0),
            ],
            [
              "AVG RETURN",
              data?.performance?.[selected]?.completed
                ? `${data.performance[selected].averageReturn.toFixed(2)}%`
                : "NOT ENOUGH DATA YET",
            ],
            [
              "MAX DRAWDOWN",
              backtest
                ? `${Number(backtestMetrics.maximumDrawdownPct ?? 0).toFixed(2)}% BACKTEST`
                : "NOT ENOUGH DATA YET",
            ],
          ].map(([label, value]) => (
            <div className="module" key={String(label)}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <WorkflowTable
          title="RECENT SIGNALS"
          empty="NO PERSISTED SIGNALS YET"
          headings={["SYMBOL", "DIRECTION", "SCORE", "REASON", "TIME"]}
          rows={signals
            .slice(0, 10)
            .map((signal) => [
              String(signal.symbol),
              String(signal.direction),
              String(signal.score),
              String(signal.reasoning ?? "—"),
              new Date(String(signal.evaluated_at)).toLocaleString(),
            ])}
        />
        <WorkflowTable
          title="RECENT COMPLETED TRADES"
          empty="NO COMPLETED PAPER TRADES FOR THIS STRATEGY"
          headings={[
            "SYMBOL",
            "SIDE",
            "CLASS",
            "NET P/L",
            "RETURN",
            "EXIT",
            "TIME",
          ]}
          rows={recentTrades
            .slice(0, 10)
            .map((trade) => [
              String(trade.symbol),
              String(trade.direction),
              String(trade.classification),
              signed(trade.net_pl),
              `${Number(trade.return_pct ?? 0).toFixed(2)}%`,
              String(trade.exit_reason ?? "BROKER POSITION CLOSED"),
              new Date(String(trade.exit_timestamp)).toLocaleString(),
            ])}
        />
        <button
          className="text-button strategy-backtest-link"
          onClick={openBacktesting}
        >
          VIEW HISTORICAL / BACKTESTING EVIDENCE →
        </button>
      </section>
    </div>
  );
}

function strategyRegime(name: string) {
  if (name === "Momentum" || name === "Trend Following") return "TRENDING";
  if (name === "Breakout") return "BREAKOUT / EXPANSION";
  if (name === "Mean Reversion") return "RANGE / REVERSAL";
  return "REGIME-AWARE COMBINATION";
}

function strategyExplanation(name: string) {
  if (name === "Momentum")
    return "Looks for sustained directional price strength with confirming market data.";
  if (name === "Breakout")
    return "Looks for price moving beyond a defined range with sufficient confirmation.";
  if (name === "Trend Following")
    return "Looks for established directional structure and follows it while risk remains bounded.";
  if (name === "Mean Reversion")
    return "Looks for unusually extended prices that may return toward a normal range.";
  return "Combines production strategy signals conservatively and resolves weak or conflicting evidence to NO TRADE.";
}
