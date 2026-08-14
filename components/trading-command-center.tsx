"use client";
import { useEffect, useRef, useState } from "react";
import { defaultRiskSettings as limits } from "@/src/config/trading";
import type {
  AuditEvent,
  RiskSettings,
  CombinedOpportunity,
  AutoTraderConfig,
  SystemState,
  TradeRecommendation,
  MarketQuote,
} from "@/src/domain/models";
import {
  TradePermissionService,
  requestTradingMode,
} from "@/src/services/trade-permission";
import type { DashboardPersistence } from "@/src/lib/supabase/repository";
import type { BrokerDashboardData } from "@/src/services/broker/dashboard";
import { LogoutButton } from "./logout-button";
import {
  NotificationCenterWorkspace,
  NotificationSettingsWorkspace,
} from "./notification-workspace";

type AutoState = "ACTIVE" | "PAUSED" | "LOCKED";
type Modal = "analysis" | "modify" | "position" | "reset" | null;
type HostedPortfolio = {
  source: "ALPACA_PAPER" | "DEMO";
  account: null | {
    equity: number;
    cash: number;
    buying_power: number;
    realized_pl_today: number;
    unrealized_pl: number;
    open_exposure: number;
    position_count: number;
    as_of: string;
  };
  positions: Array<Record<string, string | number | null>>;
  fills: Array<Record<string, string | number | null>>;
};
const nav = [
  "Dashboard",
  "Auto Trader",
  "Big Money",
  "Opportunities",
  "Portfolio",
  "Strategies",
  "Backtesting",
  "Paper Trading",
  "Trade Journal",
  "Risk Manager",
  "Notifications",
  "Settings",
];
const icons = ["⌂", "◉", "◆", "⌁", "▣", "⌘", "↗", "◎", "≡", "◇", "○", "⚙"];
const ranges: { [key: string]: number[] } = {
  "1D": [38, 41, 40, 45, 43, 48, 51, 49, 55, 58, 57, 62],
  "1W": [30, 33, 31, 38, 41, 39, 46, 48, 52, 57, 55, 62],
  "1M": [26, 29, 34, 32, 39, 43, 46, 51, 49, 56, 60, 62],
  "3M": [20, 25, 23, 31, 35, 39, 37, 45, 50, 54, 58, 62],
  "1Y": [14, 19, 24, 21, 30, 35, 40, 46, 43, 52, 57, 62],
  ALL: [8, 16, 13, 24, 29, 37, 34, 45, 51, 48, 57, 62],
};
const positions = [
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    direction: "BUY",
    entry: "$181.42",
    current: "$184.16",
    size: "$4,200",
    stop: "$176.90",
    target: "$194.00",
    pnl: 63.44,
    pct: 1.51,
    strategy: "Momentum V2",
    status: "OPEN",
  },
  {
    symbol: "EUR/USD",
    name: "Euro / US Dollar",
    direction: "BUY",
    entry: "1.1662",
    current: "1.1638",
    size: "$3,000",
    stop: "1.1580",
    target: "1.1810",
    pnl: -20.58,
    pct: -0.69,
    strategy: "FX Trend",
    status: "OPEN",
  },
  {
    symbol: "XAU/USD",
    name: "Gold / US Dollar",
    direction: "SELL",
    entry: "3,362.20",
    current: "3,350.60",
    size: "$3,800",
    stop: "3,398.00",
    target: "3,284.00",
    pnl: 42.18,
    pct: 1.11,
    strategy: "Macro Reversal",
    status: "OPEN",
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    direction: "BUY",
    entry: "$225.10",
    current: "$227.42",
    size: "$2,900",
    stop: "$218.40",
    target: "$248.50",
    pnl: 29.87,
    pct: 1.03,
    strategy: "Quality Breakout",
    status: "OPEN",
  },
];
const markets = [
  { n: "S&P 500", v: "6,498.11", p: 0.42 },
  { n: "NASDAQ", v: "21,713.14", p: 0.66 },
  { n: "Gold", v: "3,350.60", p: -0.18 },
  { n: "EUR/USD", v: "1.1638", p: -0.21 },
  { n: "Bitcoin", v: "118,420", p: 1.24 },
];
const scores = [
  { n: "Trend", v: 94 },
  { n: "Momentum", v: 88 },
  { n: "Volume", v: 81 },
  { n: "Volatility", v: 76 },
  { n: "Fundamentals", v: 92 },
  { n: "News sentiment", v: 84 },
  { n: "Market environment", v: 87 },
];
const initialRec: TradeRecommendation = {
  id: "r1",
  asset: {
    id: "aapl",
    symbol: "AAPL",
    name: "Apple Inc.",
    assetClass: "EQUITY",
    currency: "USD",
  },
  direction: "BUY",
  score: 91,
  investment: 5000,
  stopLoss: 218.4,
  takeProfit: 248.5,
  riskReward: 2.7,
  marketCondition: "Bullish consolidation",
  status: "PENDING",
  createdAt: "2026-08-13T12:42:00Z",
};
const cash = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export function TradingCommandCenter({
  ownerEmail,
  persistence,
  broker,
}: {
  ownerEmail: string;
  persistence: DashboardPersistence;
  broker: BrokerDashboardData;
}) {
  const [section, setSection] = useState("Dashboard"),
    [range, setRange] = useState("1M"),
    [auto, setAuto] = useState<AutoState>(
      persistence.emergencyStopActive ||
        persistence.dailyRiskStatus !== "NORMAL"
        ? "LOCKED"
        : persistence.autoTraderStatus,
    ),
    [locked, setLocked] = useState(persistence.emergencyStopActive),
    [modal, setModal] = useState<Modal>(null),
    [rec, setRec] = useState({
      ...initialRec,
      status: persistence.recommendationStatus,
    }),
    [toast, setToast] = useState(""),
    [riskOption, setRiskOption] = useState("Recommended"),
    [investment, setInvestment] = useState(5000),
    [selectedPosition, setSelectedPosition] = useState(positions[0]),
    [, setAudit] = useState<AuditEvent[]>([]);
  const [liveMarket, setLiveMarket] = useState({
    source: broker.marketDataSource,
    status: broker.marketDataStatus,
    lastUpdated: broker.marketDataLastUpdated,
    ageMs: broker.marketDataAgeMs,
    quotes: {} as Record<string, MarketQuote>,
  });
  const [hostedPortfolio, setHostedPortfolio] = useState<HostedPortfolio>({
    source: "DEMO",
    account: null,
    positions: [],
    fills: [],
  });
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "section",
    );
    if (requested && nav.includes(requested))
      queueMicrotask(() => setSection(requested));
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/portfolio", { cache: "no-store" });
        if (response.ok && active)
          setHostedPortfolio((await response.json()) as HostedPortfolio);
      } catch {
        // Preserve the last synchronized PAPER snapshot during transient errors.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          "/api/market-data?symbols=AAPL,NVDA,MSFT,AMZN",
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          source: string;
          status: string;
          lastUpdated: string | null;
          ageMs: number | null;
          quotes: MarketQuote[];
        };
        if (active)
          setLiveMarket({
            source: data.source,
            status:
              data.status === "CONNECTED" ? "MARKET_DATA_ACTIVE" : "ERROR",
            lastUpdated: data.lastUpdated,
            ageMs: data.ageMs,
            quotes: Object.fromEntries(
              (data.quotes ?? []).map((quote) => [
                quote.assetId.toUpperCase(),
                quote,
              ]),
            ),
          });
      } catch {
        if (active)
          setLiveMarket((current) => ({
            ...current,
            source: "MARKET DATA DISCONNECTED",
            status: "ERROR",
          }));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const displayedBroker: BrokerDashboardData = {
    ...broker,
    source:
      hostedPortfolio.source === "ALPACA_PAPER"
        ? "ALPACA_PAPER"
        : broker.source,
    summary: hostedPortfolio.account
      ? {
          accountIdMasked: broker.summary?.accountIdMasked ?? "****",
          balance: hostedPortfolio.account.equity,
          netLiquidation: hostedPortfolio.account.equity,
          availableCash: hostedPortfolio.account.cash,
          buyingPower: hostedPortfolio.account.buying_power,
          currency: "USD",
          status: "PAPER_CONNECTED",
          lastSuccessfulSync: hostedPortfolio.account.as_of,
          lastError: null,
        }
      : broker.summary,
    marketDataSource: liveMarket.source,
    marketDataStatus: liveMarket.status,
    marketDataLastUpdated: liveMarket.lastUpdated,
    marketDataAgeMs: liveMarket.ageMs,
  };
  const synchronizedPositions = hostedPortfolio.positions.map((position) => ({
    symbol: String(position.symbol),
    name: "Alpaca PAPER position",
    direction: String(position.side) === "SHORT" ? "SELL" : "BUY",
    entry: `$${Number(position.entry_price).toFixed(2)}`,
    current: `$${Number(position.current_price).toFixed(2)}`,
    size: cash(Number(position.market_value)),
    stop:
      position.stop_loss == null
        ? "NOT SET"
        : `$${Number(position.stop_loss).toFixed(2)}`,
    target:
      position.take_profit == null
        ? "NOT SET"
        : `$${Number(position.take_profit).toFixed(2)}`,
    pnl: Number(position.unrealized_pl),
    pct: Number(Number(position.unrealized_pl_pct).toFixed(2)),
    strategy: String(position.strategy_name ?? "External / Manual PAPER"),
    status: String(position.status),
  })) as typeof positions;
  const livePositions = (
    hostedPortfolio.source === "ALPACA_PAPER"
      ? synchronizedPositions
      : positions
  ).map((position) => {
    const quote = liveMarket.quotes[position.symbol];
    if (!quote) return position;
    const entry = Number(position.entry.replace(/[$,]/g, ""));
    const size = Number(position.size.replace(/[$,]/g, ""));
    const quantity = entry > 0 ? size / entry : 0;
    const pnl =
      (quote.last - entry) *
      quantity *
      (position.direction === "SELL" ? -1 : 1);
    return {
      ...position,
      current: `$${quote.last.toFixed(2)}`,
      pnl: Number(pnl.toFixed(2)),
      pct: Number(((pnl / Math.max(size, 1)) * 100).toFixed(2)),
    };
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const state: SystemState = {
    mode: "PAPER",
    autoTraderStatus: auto,
    riskState: locked ? "LOCKED" : "NORMAL",
    emergencyStopActive: locked,
  };
  const permission = new TradePermissionService(state, limits);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (modal) {
      dialogRef.current?.focus();
      const close = (e: KeyboardEvent) => {
        if (e.key === "Escape") setModal(null);
      };
      document.addEventListener("keydown", close);
      return () => document.removeEventListener("keydown", close);
    }
  }, [modal]);
  const log = (action: AuditEvent["action"]) => {
    setAudit((a) => [
      {
        id: crypto.randomUUID(),
        userId: "owner",
        action,
        timestamp: new Date().toISOString(),
        metadata: { mode: "PAPER" },
      },
      ...a,
    ]);
    void fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, recommendationId: rec.id }),
    })
      .then((response) => {
        if (!response.ok) setToast("Supabase sync was not completed.");
      })
      .catch(() => setToast("Supabase sync is temporarily unavailable."));
  };
  const approve = () => {
    if (!permission.canApproveRecommendation(rec)) {
      setToast("Approval blocked — Emergency Stop is active.");
      return;
    }
    setRec({ ...rec, status: "APPROVED", investment });
    setModal(null);
    log("RECOMMENDATION_APPROVED");
  };
  const reject = () => {
    setRec({ ...rec, status: "REJECTED" });
    setModal(null);
    log("RECOMMENDATION_REJECTED");
  };
  const emergency = () => {
    setLocked(true);
    setAuto("LOCKED");
    log("EMERGENCY_STOP_ACTIVATED");
  };
  const reset = () => {
    setLocked(false);
    setAuto("PAUSED");
    setModal(null);
    log("EMERGENCY_STOP_RESET");
    setToast("Safety lock reset. Auto Trader remains paused.");
  };
  return (
    <div className="app-shell">
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <strong>TRADING</strong>
            <span>COMMAND CENTER</span>
          </div>
        </div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map((n, i) => (
            <button
              key={n}
              className={section === n ? "active" : ""}
              onClick={() => setSection(n)}
            >
              <span aria-hidden="true">{icons[i]}</span>
              {n}
              {n === "Notifications" && <i>3</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="paper-pill">
            <span /> PAPER MODE
          </div>
          <div className="data-source">
            {persistence.source === "SUPABASE"
              ? "SUPABASE DATA"
              : "DEMO FALLBACK"}
          </div>
          <div className="profile">
            <b>{ownerEmail.slice(0, 2).toUpperCase()}</b>
            <div>
              <strong>{ownerEmail}</strong>
              <small>
                <span /> System operational
              </small>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <p>COMMAND CENTER / {section.toUpperCase()}</p>
            <h1>{section}</h1>
          </div>
          <div className="top-tools">
            <span className="market-open">
              <i /> {liveMarket.source} ·{" "}
              {liveMarket.status === "MARKET_DATA_ACTIVE"
                ? "CONNECTED"
                : "DISCONNECTED"}
            </span>
            <button className="paper">PAPER</button>
            <button
              className="live"
              onClick={() => setToast(requestTradingMode("LIVE").error!)}
            >
              LIVE LOCKED
            </button>
            <button className="icon-button" aria-label="Notifications">
              ●<sup>3</sup>
            </button>
            <time>
              13 AUG 2026
              <br />
              <b>14:52 SAST</b>
            </time>
            <button className="avatar" aria-label="Profile menu">
              JD
            </button>
          </div>
        </header>
        {locked && (
          <div className="lock-banner">
            <div>
              <b>⛔ SYSTEM LOCKED</b>
              <span>
                Emergency Stop active. Automated trading and approvals are
                disabled.
              </span>
            </div>
            <button onClick={() => setModal("reset")}>
              RESET EMERGENCY STOP
            </button>
          </div>
        )}
        {persistence.dailyRiskStatus === "DAILY_LOCK" && (
          <div className="lock-banner daily-lock-banner">
            <div>
              <b>AUTO TRADER LOCKED FOR TODAY</b>
              <span>
                {persistence.dailyRiskReason?.replaceAll("_", " ") ??
                  "Daily risk boundary reached"}
                . Existing positions remain managed.
              </span>
            </div>
          </div>
        )}
        {section === "Dashboard" ? (
          <Dashboard
            range={range}
            setRange={setRange}
            auto={auto}
            locked={locked}
            rec={rec}
            setRec={setRec}
            investment={investment}
            setInvestment={setInvestment}
            setModal={setModal}
            approve={approve}
            reject={reject}
            emergency={emergency}
            pause={() => {
              setAuto("PAUSED");
              log("AUTO_TRADER_PAUSED");
            }}
            resume={() => {
              if (!locked) {
                setAuto("ACTIVE");
                log("AUTO_TRADER_RESUMED");
              }
            }}
            openPosition={(p) => {
              setSelectedPosition(p);
              setModal("position");
            }}
            broker={displayedBroker}
            persistence={persistence}
            livePositions={livePositions}
            portfolio={hostedPortfolio}
          />
        ) : section === "Auto Trader" ? (
          <AutoTraderWorkspace emergencyLocked={locked} />
        ) : section === "Big Money" ? (
          <BigMoneyWorkspace emergencyLocked={locked} />
        ) : section === "Strategy Engine" || section === "Opportunities" ? (
          <StrategyWorkspace page={section} />
        ) : section === "Risk Manager" ? (
          <RiskSettingsWorkspace initial={persistence.riskSettings} />
        ) : section === "Backtesting" ? (
          <BacktestingWorkspace />
        ) : section === "Notifications" ? (
          <NotificationCenterWorkspace />
        ) : section === "Settings" ? (
          <NotificationSettingsWorkspace />
        ) : section === "Paper Trading" ? (
          <BrokerWorkspace broker={displayedBroker} locked={locked} />
        ) : (
          <div className="empty-state">
            <span>{icons[nav.indexOf(section)]}</span>
            <h2>{section}</h2>
            <p>
              This workspace is prepared for a future mission. Trading remains
              in paper mode.
            </p>
          </div>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {[
          ["Dashboard", "⌂", "Home"],
          ["Auto Trader", "◉", "Auto"],
          ["Big Money", "◆", "Trades"],
          ["Portfolio", "▣", "Portfolio"],
          ["Settings", "•••", "More"],
        ].map(([s, i, l]) => (
          <button
            key={s}
            className={section === s ? "active" : ""}
            onClick={() => setSection(s)}
          >
            <span>{i}</span>
            {l}
          </button>
        ))}
      </nav>
      {modal && (
        <ModalFrame
          title={
            modal === "reset"
              ? "Reset Emergency Stop?"
              : modal === "position"
                ? `${selectedPosition.symbol} Position`
                : modal === "modify"
                  ? "Modify Recommendation"
                  : "AAPL Recommendation Analysis"
          }
          close={() => setModal(null)}
          refEl={dialogRef}
        >
          {modal === "reset" ? (
            <ResetModal reset={reset} close={() => setModal(null)} />
          ) : modal === "position" ? (
            <PositionDetail p={selectedPosition} />
          ) : (
            <RecommendationDetail
              rec={rec}
              option={riskOption}
              setOption={setRiskOption}
              investment={investment}
              setInvestment={setInvestment}
              modifying={modal === "modify"}
              approve={approve}
              reject={reject}
              locked={locked}
            />
          )}
        </ModalFrame>
      )}
    </div>
  );
}
type BigMoneyRow = {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  score: number;
  research_score: number;
  current_price: number;
  investment: number;
  stop_loss: number;
  take_profit: number;
  maximum_planned_loss: number;
  risk_reward: number;
  market_condition: string;
  status: string;
  data_source: string;
  quote_timestamp: string;
  expires_at: string;
  selected_risk_profile: string;
  risk_profiles: Array<{
    name: string;
    capital: number;
    stopLoss: number;
    maximumPlannedLoss: number;
    target: number;
    riskReward: number;
  }>;
  analysis: {
    supportingStrategies: string[];
    conflictingStrategies: string[];
    reasoning: string;
    portfolioExposure: number;
    unavailableResearch: string[];
  };
  created_at: string;
};
type IntelligenceRow = {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL" | "NO_TRADE";
  current_price: number;
  opportunity_score: number;
  confidence: number;
  technical_score: number;
  fundamental_score: number;
  catalyst_score: number;
  market_context_score: number;
  historical_score: number;
  risk_score: number;
  ai_status: string;
  ai_analysis: null | Record<string, string | string[]>;
  source_facts: Record<string, unknown>;
  freshness: Record<string, { status: string; ageMs: number | null }>;
  source_references: Array<{
    provider: string;
    id: string;
    timestamp: string;
    url: string;
  }>;
  generated_at: string;
};

function BigMoneyWorkspace({ emergencyLocked }: { emergencyLocked: boolean }) {
  const [items, setItems] = useState<BigMoneyRow[]>([]),
    [selected, setSelected] = useState<BigMoneyRow | null>(null),
    [symbol, setSymbol] = useState("AAPL"),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [message, setMessage] = useState(""),
    [clock, setClock] = useState(() => Date.now()),
    [intelligence, setIntelligence] = useState<IntelligenceRow[]>([]),
    [selectedIntel, setSelectedIntel] = useState<IntelligenceRow | null>(null);
  const load = async () => {
    const response = await fetch("/api/big-money", { cache: "no-store" });
    const data = (await response.json()) as { recommendations?: BigMoneyRow[] };
    const next = data.recommendations ?? [];
    setItems(next);
    setSelected((current) =>
      current ? (next.find((item) => item.id === current.id) ?? null) : null,
    );
  };
  useEffect(() => {
    void fetch("/api/big-money", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { recommendations?: BigMoneyRow[] }) =>
        setItems(data.recommendations ?? []),
      )
      .catch(() => setMessage("Research recommendations are unavailable."));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const refresh = () =>
      void fetch("/api/intelligence", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { opportunities?: IntelligenceRow[] }) =>
          setIntelligence(data.opportunities ?? []),
        )
        .catch(() => undefined);
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  const action = async (
    actionName: "GENERATE" | "REFRESH" | "MODIFY" | "REJECT" | "APPROVE",
    extra: Record<string, unknown> = {},
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/big-money", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          symbol: selected?.symbol ?? symbol,
          recommendationId: selected?.id,
          ...extra,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
      };
      setMessage(
        response.ok
          ? `${actionName} completed in PAPER mode.`
          : (result.error ?? "Action blocked safely."),
      );
      setConfirming(false);
      await load();
    } catch {
      setMessage("Big Money request failed safely.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="broker-workspace big-money-workspace">
      <section className="module broker-panel">
        <header className="module-head">
          <div>
            <span className="section-label">BIG MONEY RESEARCH</span>
            <p>Market Data → Strategy → Research → Risk → Owner Approval</p>
          </div>
          <span className="paper-trade-label">PAPER ONLY · OWNER APPROVAL</span>
        </header>
        <div className="ticket-grid">
          <label>
            ASSET
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            >
              {[
                "AAPL",
                "MSFT",
                "NVDA",
                "AMZN",
                "GOOGL",
                "META",
                "TSLA",
                "AMD",
                "NFLX",
                "SPY",
                "QQQ",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button disabled={busy} onClick={() => void action("GENERATE")}>
            GENERATE RESEARCH
          </button>
        </div>
        {message && <div className="broker-error">{message}</div>}
        <div className="table-scroll">
          <table className="position-table">
            <thead>
              <tr>
                {[
                  "SYMBOL",
                  "SIDE",
                  "STRATEGY SCORE",
                  "RESEARCH SCORE",
                  "PRICE",
                  "CAPITAL",
                  "MAX LOSS",
                  "TARGET",
                  "R/R",
                  "CONDITION",
                  "STATUS",
                  "AGE",
                ].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelected(item)}
                  tabIndex={0}
                >
                  <td>
                    <b>{item.symbol}</b>
                  </td>
                  <td>
                    <DirectionBadge direction={item.direction} />
                  </td>
                  <td>{item.score}/100 model score</td>
                  <td>{item.research_score}/100 model score</td>
                  <td>${Number(item.current_price).toFixed(2)}</td>
                  <td>{cash(Number(item.investment))}</td>
                  <td>{cash(Number(item.maximum_planned_loss))}</td>
                  <td>${Number(item.take_profit).toFixed(2)}</td>
                  <td>{Number(item.risk_reward).toFixed(2)}</td>
                  <td>{item.market_condition}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>
                    {Math.max(
                      0,
                      Math.round((clock - Date.parse(item.created_at)) / 60000),
                    )}
                    m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="module broker-panel">
        <header className="module-head">
          <div>
            <span className="section-label">
              MARKET INTELLIGENCE OPPORTUNITY FEED
            </span>
            <p>
              Deterministic scores · confidence measures data quality, not
              outcome forecast
            </p>
          </div>
          <button
            onClick={() =>
              void fetch("/api/intelligence", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ symbol }),
              }).then(() => setMessage(`${symbol} research queued on Railway.`))
            }
          >
            REFRESH RESEARCH
          </button>
        </header>
        <div className="table-scroll">
          <table className="position-table">
            <thead>
              <tr>
                {[
                  "SYMBOL",
                  "DIRECTION",
                  "OPPORTUNITY",
                  "CONFIDENCE",
                  "PRICE",
                  "TECHNICAL",
                  "FUNDAMENTAL",
                  "CATALYST",
                  "RISK",
                  "FRESHNESS",
                ].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {intelligence.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  onClick={() => setSelectedIntel(item)}
                >
                  <td>
                    <b>{item.symbol}</b>
                  </td>
                  <td>{item.direction}</td>
                  <td>{item.opportunity_score}/100</td>
                  <td>{item.confidence}/100 data quality</td>
                  <td>${Number(item.current_price).toFixed(2)}</td>
                  <td>{item.technical_score}</td>
                  <td>{item.fundamental_score}</td>
                  <td>{item.catalyst_score}</td>
                  <td>{item.risk_score}</td>
                  <td>
                    {Object.values(item.freshness).some(
                      (value) => value.status === "STALE",
                    )
                      ? "STALE INPUTS"
                      : "CURRENT"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selectedIntel && (
        <section className="module broker-panel">
          <header className="module-head">
            <div>
              <span className="section-label">
                {selectedIntel.symbol} DETAILED RESEARCH
              </span>
              <p>SOURCE FACTS are separated from AI INTERPRETATION</p>
            </div>
            <StatusBadge status={selectedIntel.ai_status} />
          </header>
          <div className="broker-details">
            <FinancialMetric
              label="OPPORTUNITY"
              value={`${selectedIntel.opportunity_score}/100`}
              note="Deterministic weighted score"
            />
            <FinancialMetric
              label="CONFIDENCE"
              value={`${selectedIntel.confidence}/100`}
              note="Data completeness and freshness"
            />
            <FinancialMetric
              label="MARKET CONTEXT"
              value={`${selectedIntel.market_context_score}/100`}
              note="SPY · QQQ · DIA · IWM"
            />
            <FinancialMetric
              label="HISTORICAL"
              value={`${selectedIntel.historical_score}/100`}
              note="Not a forecast or guarantee"
            />
          </div>
          <div className="research-full">
            <b>SOURCE FACTS</b>
            <pre>{JSON.stringify(selectedIntel.source_facts, null, 2)}</pre>
          </div>
          <div className="research-full">
            <b>AI INTERPRETATION</b>
            <p>
              {selectedIntel.ai_status === "AI ANALYSIS UNAVAILABLE"
                ? "AI ANALYSIS UNAVAILABLE"
                : String(
                    selectedIntel.ai_analysis?.executiveSummary ??
                      "Structured analysis available below.",
                  )}
            </p>
          </div>
          {(
            [
              "bullCase",
              "bearCase",
              "catalysts",
              "risks",
              "invalidation",
            ] as const
          ).map((key) => (
            <div className="research-full" key={key}>
              <b>
                {key === "bullCase"
                  ? "BULL CASE"
                  : key === "bearCase"
                    ? "BEAR CASE"
                    : key === "catalysts"
                      ? "KEY CATALYSTS"
                      : key === "risks"
                        ? "KEY RISKS"
                        : "WHAT WOULD INVALIDATE THIS SETUP"}
              </b>
              <p>
                {Array.isArray(selectedIntel.ai_analysis?.[key])
                  ? (selectedIntel.ai_analysis?.[key] as string[]).join(" · ")
                  : "AI ANALYSIS UNAVAILABLE"}
              </p>
            </div>
          ))}
          <div className="research-full">
            <b>SOURCE REFERENCES</b>
            {selectedIntel.source_references.map((source) => (
              <p key={`${source.provider}:${source.id}`}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.provider} · {source.id}
                </a>{" "}
                · {new Date(source.timestamp).toLocaleString()}
              </p>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <section className="module broker-panel">
          <header className="module-head">
            <div>
              <span className="section-label">
                {selected.symbol} DETAILED ANALYSIS
              </span>
              <p>
                {selected.data_source} · quote{" "}
                {new Date(selected.quote_timestamp).toLocaleString()}
              </p>
            </div>
            <StatusBadge status={selected.status} />
          </header>
          <div className="broker-details">
            <FinancialMetric
              label="STRATEGY"
              value={`${selected.score}/100`}
              note="Model signal score · not a probability of profit"
            />
            <FinancialMetric
              label="RESEARCH"
              value={`${selected.research_score}/100`}
              note="Model research score · not a probability of profit"
            />
            <FinancialMetric
              label="PORTFOLIO EXPOSURE"
              value={cash(Number(selected.analysis?.portfolioExposure ?? 0))}
              note="Before this recommendation"
            />
            <FinancialMetric
              label="FRESHNESS"
              value={
                Date.parse(selected.expires_at) > clock ? "CURRENT" : "EXPIRED"
              }
              note={`Expires ${new Date(selected.expires_at).toLocaleTimeString()}`}
            />
          </div>
          <p>{selected.analysis?.reasoning}</p>
          <p>
            <b>Supporting:</b>{" "}
            {selected.analysis?.supportingStrategies?.join(", ") || "None"}
          </p>
          <p>
            <b>Conflicting:</b>{" "}
            {selected.analysis?.conflictingStrategies?.join(", ") || "None"}
          </p>
          <p>
            <b>Unavailable research:</b>{" "}
            {selected.analysis?.unavailableResearch?.join(", ") || "None"}
          </p>
          <div className="risk-options">
            {(selected.risk_profiles ?? []).map((profile) => (
              <button
                key={profile.name}
                className={
                  selected.selected_risk_profile === profile.name
                    ? "active"
                    : ""
                }
                onClick={() =>
                  void action("MODIFY", {
                    modifications: {
                      selectedRiskProfile: profile.name,
                      recommendedCapital: profile.capital,
                      recommendedStopLoss: profile.stopLoss,
                      recommendedTakeProfit: profile.target,
                    },
                  })
                }
              >
                <b>{profile.name}</b>
                <span>
                  {cash(profile.capital)} · stop ${profile.stopLoss} · max loss{" "}
                  {cash(profile.maximumPlannedLoss)} · target ${profile.target}{" "}
                  · {profile.riskReward}R
                </span>
              </button>
            ))}
          </div>
          <div className="recommendation-actions">
            <button disabled={busy} onClick={() => void action("REFRESH")}>
              REFRESH ANALYSIS
            </button>
            <button
              disabled={busy || selected.status !== "PENDING"}
              onClick={() =>
                void action("REJECT", { rejectionReason: "OWNER_REJECTED" })
              }
            >
              REJECT
            </button>
            {!confirming ? (
              <button
                disabled={
                  busy || emergencyLocked || selected.status !== "PENDING"
                }
                onClick={() => setConfirming(true)}
              >
                APPROVE
              </button>
            ) : (
              <button
                className="emergency"
                disabled={busy || emergencyLocked}
                onClick={() => void action("APPROVE", { paperConfirmed: true })}
              >
                CONFIRM PAPER TRADE ONLY
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

type StoredAutomatedDecision = {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  reason: string;
  signal_score: number;
  strategies: string[];
  capital: number;
  maximum_planned_loss: number;
  stop_loss: number | null;
  take_profit: number | null;
  execution_source: string;
  created_at: string;
};
type AutoDaily = {
  profit_loss: number;
  trades: number;
  wins: number;
  losses: number;
  deployed_capital: number;
  status: string;
  lock_reason: string | null;
} | null;
function AutoTraderWorkspace({
  emergencyLocked,
}: {
  emergencyLocked: boolean;
}) {
  const [config, setConfig] = useState<AutoTraderConfig | null>(null),
    [daily, setDaily] = useState<AutoDaily>(null),
    [systemStatus, setSystemStatus] = useState("PAUSED"),
    [decisions, setDecisions] = useState<StoredAutomatedDecision[]>([]),
    [symbol, setSymbol] = useState("AAPL"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = async () => {
    const response = await fetch("/api/auto-trader");
    const data = (await response.json()) as {
      config: AutoTraderConfig;
      daily: AutoDaily;
      decisions: StoredAutomatedDecision[];
      systemStatus: string;
    };
    setConfig(data.config);
    setDaily(data.daily);
    setDecisions(data.decisions);
    setSystemStatus(data.systemStatus);
  };
  useEffect(() => {
    void fetch("/api/auto-trader")
      .then((response) => response.json())
      .then(
        (data: {
          config: AutoTraderConfig;
          daily: AutoDaily;
          decisions: StoredAutomatedDecision[];
          systemStatus: string;
        }) => {
          setConfig(data.config);
          setDaily(data.daily);
          setDecisions(data.decisions);
          setSystemStatus(data.systemStatus);
        },
      )
      .catch(() => setMessage("Auto Trader state is unavailable."));
  }, []);
  const action = async (
    actionName: "CONFIGURE" | "RUN" | "PAUSE" | "RESUME",
  ) => {
    if (!config) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auto-trader", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          config,
          symbol,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
        reason?: string;
      };
      setMessage(
        response.ok
          ? (result.reason ?? `${actionName} completed in PAPER mode.`)
          : (result.error ?? "Auto Trader action rejected."),
      );
      await load();
    } catch {
      setMessage("Auto Trader request failed safely.");
    } finally {
      setBusy(false);
    }
  };
  if (!config)
    return <div className="strategy-empty">Loading Auto Trader state…</div>;
  const status = emergencyLocked
    ? "LOCKED"
    : daily?.status === "LOCKED" || daily?.status === "TARGET_REACHED"
      ? daily.status
      : systemStatus;
  const deployed = Number(daily?.deployed_capital ?? 0);
  return (
    <div className="auto-workspace">
      <section className="module auto-hero">
        <header className="module-head">
          <div>
            <span className="section-label">AUTOMATED PAPER WORKFLOW</span>
            <p>Strategy → Risk → Permission → Paper Broker → Journal</p>
          </div>
          <div className="auto-statuses">
            <StatusBadge status={status} />
            <StatusBadge status="PAPER" />
          </div>
        </header>
        {(status === "LOCKED" || status === "TARGET_REACHED") && (
          <div className="score-disclaimer">
            {status === "TARGET_REACHED"
              ? "AUTO TRADER TARGET REACHED"
              : "AUTO TRADER LOCKED FOR TODAY"}
            {daily?.lock_reason
              ? ` — ${daily.lock_reason.replaceAll("_", " ")}`
              : ""}
            . EXISTING POSITIONS REMAIN MANAGEABLE.
          </div>
        )}
        <div className="auto-metrics">
          <FinancialMetric
            label="ALLOCATED CAPITAL"
            value={cash(config.capitalAllocation)}
            note="PAPER limit"
          />
          <FinancialMetric
            label="DEPLOYED CAPITAL"
            value={cash(deployed)}
            note="Auto positions"
          />
          <FinancialMetric
            label="AVAILABLE CAPITAL"
            value={cash(Math.max(0, config.capitalAllocation - deployed))}
            note="Before risk checks"
          />
          <FinancialMetric
            label="TODAY'S P/L"
            value={cash(Number(daily?.profit_loss ?? 0))}
            note={`Target ${cash(config.dailyProfitTarget)} · Loss ${cash(config.dailyLossLimit)}`}
          />
          <FinancialMetric
            label="TRADES TODAY"
            value={`${daily?.trades ?? 0} / ${config.maximumTradesPerDay}`}
            note={`${daily?.wins ?? 0} wins · ${daily?.losses ?? 0} losses`}
          />
          <FinancialMetric
            label="MINIMUM SCORE"
            value={`${config.minimumStrategyScore}/100`}
            note="Signal strength, not probability"
          />
        </div>
        <div className="auto-actions">
          <button
            className="button"
            disabled={busy || emergencyLocked}
            onClick={() => action(config.enabled ? "PAUSE" : "RESUME")}
          >
            {config.enabled ? "PAUSE AUTO TRADER" : "ENABLE AUTO TRADER"}
          </button>
          <select
            aria-label="Auto Trader asset"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          >
            {config.allowedAssets.map((asset) => (
              <option key={asset}>{asset}</option>
            ))}
          </select>
          <button
            className="button primary"
            disabled={busy || emergencyLocked || !config.enabled}
            onClick={() => action("RUN")}
          >
            {busy ? "PROCESSING…" : "RUN PAPER CYCLE"}
          </button>
        </div>
        {message && (
          <div className="ticket-state" role="status">
            {message}
          </div>
        )}
      </section>
      <section className="module auto-config">
        <header className="module-head">
          <div>
            <span className="section-label">AUTO TRADER CONFIGURATION</span>
            <p>Owner-controlled eligibility boundaries</p>
          </div>
        </header>
        <div className="auto-config-grid">
          {(
            [
              ["capitalAllocation", "CAPITAL ALLOCATION"],
              ["maximumTradeSize", "MAXIMUM TRADE SIZE"],
              ["maximumRiskPerTrade", "MAXIMUM RISK / TRADE"],
              ["dailyLossLimit", "DAILY LOSS LIMIT"],
              ["dailyProfitTarget", "DAILY PROFIT TARGET"],
              ["maximumTradesPerDay", "MAX TRADES / DAY"],
              ["maximumConcurrentPositions", "MAX CONCURRENT POSITIONS"],
              ["minimumStrategyScore", "MINIMUM SIGNAL SCORE"],
            ] as Array<[keyof AutoTraderConfig, string]>
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="number"
                min="0"
                max={key === "minimumStrategyScore" ? 100 : undefined}
                value={config[key] as number}
                onChange={(event) =>
                  setConfig({ ...config, [key]: Number(event.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <div className="auto-allowlist">
          <div>
            <span>ACTIVE STRATEGIES</span>
            <div className="auto-toggle-list">
              {[
                "Trend Following",
                "Momentum",
                "Breakout",
                "Mean Reversion",
              ].map((strategy) => (
                <button
                  key={strategy}
                  className={
                    config.allowedStrategies.includes(strategy) ? "active" : ""
                  }
                  aria-pressed={config.allowedStrategies.includes(strategy)}
                  onClick={() =>
                    setConfig({
                      ...config,
                      allowedStrategies: config.allowedStrategies.includes(
                        strategy,
                      )
                        ? config.allowedStrategies.filter(
                            (item) => item !== strategy,
                          )
                        : [...config.allowedStrategies, strategy],
                    })
                  }
                >
                  {strategy}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span>ALLOWED ASSETS</span>
            <div className="auto-toggle-list">
              {["AAPL", "NVDA", "MSFT", "AMZN"].map((asset) => (
                <button
                  key={asset}
                  className={
                    config.allowedAssets.includes(asset) ? "active" : ""
                  }
                  aria-pressed={config.allowedAssets.includes(asset)}
                  onClick={() =>
                    setConfig({
                      ...config,
                      allowedAssets: config.allowedAssets.includes(asset)
                        ? config.allowedAssets.filter((item) => item !== asset)
                        : [...config.allowedAssets, asset],
                    })
                  }
                >
                  {asset}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => action("CONFIGURE")}
        >
          SAVE PAPER CONFIGURATION
        </button>
      </section>
      <section className="module auto-decisions">
        <header className="module-head">
          <div>
            <span className="section-label">RECENT AUTOMATED DECISIONS</span>
            <p>Explainable, owner-scoped audit trail</p>
          </div>
        </header>
        {decisions.length ? (
          decisions.map((item) => (
            <article key={item.id} className="auto-decision">
              <StatusBadge status={item.status} />
              <div>
                <b>
                  {item.symbol} — {item.direction}
                </b>
                <small>
                  {item.strategies.join(" + ") || "No eligible strategy"} ·{" "}
                  {item.signal_score}/100 SIGNAL STRENGTH
                </small>
              </div>
              <div>
                <span>REASON</span>
                <b>{item.reason.replaceAll("_", " ")}</b>
              </div>
              <div>
                <span>CAPITAL / PLANNED LOSS</span>
                <b>
                  {cash(Number(item.capital))} /{" "}
                  {cash(Number(item.maximum_planned_loss))}
                </b>
              </div>
              <div>
                <span>PROTECTION</span>
                <b>
                  STOP {item.stop_loss ?? "—"} · TARGET{" "}
                  {item.take_profit ?? "—"}
                </b>
              </div>
              <small>
                {item.execution_source.replaceAll("_", " ")} ·{" "}
                {new Date(item.created_at).toLocaleString()}
              </small>
            </article>
          ))
        ) : (
          <div className="strategy-empty">No automated decisions yet.</div>
        )}
      </section>
    </div>
  );
}
type StoredOpportunity = {
  id: string;
  symbol: string;
  final_recommendation: "BUY" | "SELL" | "NO_TRADE";
  combined_score: number;
  supporting_strategies: string[];
  conflicting_strategies: string[];
  data_source: string;
  evaluated_at: string;
};
function StrategyWorkspace({ page }: { page: string }) {
  const [symbol, setSymbol] = useState("AAPL"),
    [evaluation, setEvaluation] = useState<CombinedOpportunity | null>(null),
    [recent, setRecent] = useState<StoredOpportunity[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const strategyNames = [
    "Trend Following",
    "Momentum",
    "Breakout",
    "Mean Reversion",
  ];
  useEffect(() => {
    void fetch("/api/strategy")
      .then((response) => response.json())
      .then((data: { opportunities?: StoredOpportunity[] }) =>
        setRecent(data.opportunities ?? []),
      )
      .catch(() => setError("Stored strategy history is unavailable."));
  }, []);
  const analyze = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data = (await response.json()) as CombinedOpportunity & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Evaluation failed.");
      setEvaluation(data);
      setRecent((items) => [
        {
          id: data.timestamp,
          symbol: data.symbol,
          final_recommendation: data.finalRecommendation,
          combined_score: data.combinedScore,
          supporting_strategies: data.supportingStrategies,
          conflicting_strategies: data.conflictingStrategies,
          data_source: data.dataSource,
          evaluated_at: data.timestamp,
        },
        ...items,
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evaluation failed.");
    } finally {
      setLoading(false);
    }
  };
  const opportunities = evaluation
    ? [
        {
          id: evaluation.timestamp,
          symbol: evaluation.symbol,
          final_recommendation: evaluation.finalRecommendation,
          combined_score: evaluation.combinedScore,
          supporting_strategies: evaluation.supportingStrategies,
          conflicting_strategies: evaluation.conflictingStrategies,
          data_source: evaluation.dataSource,
          evaluated_at: evaluation.timestamp,
        },
        ...recent.filter((item) => item.id !== evaluation.timestamp),
      ]
    : recent;
  return (
    <div className="strategy-workspace">
      <section className="module strategy-command">
        <header className="module-head">
          <div>
            <span className="section-label">
              {page === "Opportunities"
                ? "COMBINED OPPORTUNITY ENGINE"
                : "PAPER STRATEGY ENGINE"}
            </span>
            <p>Market analysis only · no order execution</p>
          </div>
          <StatusBadge status="PAPER ONLY" />
        </header>
        <div className="score-disclaimer">
          STRATEGY SCORE = NORMALIZED SIGNAL STRENGTH (0–100). IT IS NOT A
          PROBABILITY OF PROFIT.
        </div>
        <div className="strategy-controls">
          <label>
            MONITORED ASSET
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {["AAPL", "NVDA", "MSFT", "AMZN"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button
            className="button primary"
            disabled={loading}
            onClick={analyze}
          >
            {loading ? "ANALYZING…" : "RUN PAPER ANALYSIS"}
          </button>
        </div>
        {error && <div className="broker-error">{error}</div>}
      </section>
      {page === "Strategy Engine" ? (
        <>
          <section className="strategy-stat-grid">
            <div className="module">
              <span>ACTIVE STRATEGIES</span>
              <b>4</b>
              <small>All analytical</small>
            </div>
            <div className="module">
              <span>ASSETS MONITORED</span>
              <b>4</b>
              <small>AAPL · NVDA · MSFT · AMZN</small>
            </div>
            <div className="module">
              <span>RECENT SIGNALS</span>
              <b>{evaluation?.signals.length ?? recent.length}</b>
              <small>Owner-scoped history</small>
            </div>
            <div className="module">
              <span>PERFORMANCE</span>
              <b>—</b>
              <small>Placeholder · awaiting history</small>
            </div>
          </section>
          <section className="module strategy-list">
            <header className="module-head">
              <div>
                <span className="section-label">ACTIVE MODULES</span>
                <p>Independent market interpretations</p>
              </div>
            </header>
            {strategyNames.map((name) => {
              const signal = evaluation?.signals.find(
                (item) => item.strategyName === name,
              );
              return (
                <div className="strategy-row" key={name}>
                  <div>
                    <b>{name}</b>
                    <small>
                      {signal?.reasoning ?? "Ready for market evaluation"}
                    </small>
                  </div>
                  <StatusBadge status={signal?.direction ?? "ACTIVE"} />
                  <strong>
                    {signal ? signal.score : "—"}
                    <small>/100</small>
                  </strong>
                </div>
              );
            })}
          </section>
        </>
      ) : (
        <section className="module opportunities-list">
          <header className="module-head">
            <div>
              <span className="section-label">RANKED OPPORTUNITIES</span>
              <p>
                Conflicts resolve to NO TRADE when conviction is insufficient
              </p>
            </div>
          </header>
          {opportunities.length ? (
            opportunities
              .sort((a, b) => b.combined_score - a.combined_score)
              .map((item, index) => (
                <article
                  className="opportunity-row"
                  key={`${item.id}-${index}`}
                >
                  <span className="opportunity-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <b>{item.symbol}</b>
                    <small>
                      {item.data_source} ·{" "}
                      {new Date(item.evaluated_at).toLocaleString()}
                    </small>
                  </div>
                  <StatusBadge
                    status={item.final_recommendation.replace("_", " ")}
                  />
                  <div>
                    <span>SUPPORTING</span>
                    <b>{item.supporting_strategies.join(", ") || "None"}</b>
                  </div>
                  <div>
                    <span>CONFLICTING</span>
                    <b>{item.conflicting_strategies.join(", ") || "None"}</b>
                  </div>
                  <strong>
                    {item.combined_score}
                    <small>/100 SCORE</small>
                  </strong>
                </article>
              ))
          ) : (
            <div className="strategy-empty">
              Run a paper analysis to generate ranked opportunities.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
function BacktestingWorkspace() {
  const [config, setConfig] = useState({
    strategy: "Combined Opportunity",
    symbol: "AAPL",
    start: "2025-01-01",
    end: "2025-12-31",
    timeframe: "1Day",
    startingCapital: 100000,
    riskProfile: "Recommended",
    positionSizePct: 10,
    stopLossPct: 2,
    takeProfitPct: 4,
    maximumConcurrentPositions: 1,
    slippageBps: 5,
    commissionPerTrade: 0,
  });
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("Ready");
  const refresh = async () => {
    const response = await fetch("/api/backtests", { cache: "no-store" });
    if (response.ok) setRuns(((await response.json()) as { runs: [] }).runs);
  };
  useEffect(() => {
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  const run = async () => {
    setStatus("Queuing historical simulation…");
    const response = await fetch("/api/backtests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    const payload = (await response.json()) as { error?: string };
    setStatus(
      response.ok
        ? "Queued for the hosted trading engine"
        : (payload.error ?? "Queue failed"),
    );
    await refresh();
  };
  const latest = runs[0] as
    | (Record<string, unknown> & {
        metrics?: Record<string, number>;
        equity_curve?: Array<{ time: string; equity: number }>;
        drawdown_curve?: Array<{ time: string; drawdownPct: number }>;
        backtest_trades?: Array<Record<string, unknown>>;
      })
    | undefined;
  const metrics = latest?.metrics ?? {};
  return (
    <div className="workspace-page">
      <section className="module">
        <header className="module-head">
          <div>
            <span className="section-label">HISTORICAL SIMULATION</span>
            <p>Past performance does not guarantee future results.</p>
          </div>
          <StatusBadge status={String(latest?.status ?? "READY")} />
        </header>
        <div className="settings-grid">
          {[
            [
              "strategy",
              "STRATEGY",
              [
                "Momentum",
                "Breakout",
                "Trend Following",
                "Mean Reversion",
                "Combined Opportunity",
              ],
            ],
            [
              "timeframe",
              "TIMEFRAME",
              ["1Min", "5Min", "15Min", "1Hour", "1Day"],
            ],
            [
              "riskProfile",
              "RISK PROFILE",
              ["Conservative", "Recommended", "Aggressive"],
            ],
          ].map(([key, label, options]) => (
            <label key={String(key)}>
              <span>{String(label)}</span>
              <select
                value={String(config[key as keyof typeof config])}
                onChange={(event) =>
                  setConfig({ ...config, [String(key)]: event.target.value })
                }
              >
                {(options as string[]).map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
          {[
            ["symbol", "SYMBOL", "text"],
            ["start", "START", "date"],
            ["end", "END", "date"],
            ["startingCapital", "STARTING CAPITAL", "number"],
            ["positionSizePct", "POSITION SIZE %", "number"],
            ["stopLossPct", "STOP LOSS %", "number"],
            ["takeProfitPct", "TAKE PROFIT %", "number"],
            [
              "maximumConcurrentPositions",
              "MAX CONCURRENT POSITIONS",
              "number",
            ],
            ["slippageBps", "SLIPPAGE BPS", "number"],
            ["commissionPerTrade", "COMMISSION / SIDE", "number"],
          ].map(([key, label, type]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type={type}
                value={config[key as keyof typeof config]}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    [key]:
                      type === "number"
                        ? Number(event.target.value)
                        : event.target.value,
                  })
                }
              />
            </label>
          ))}
        </div>
        <footer className="risk-settings-actions">
          <span role="status">{status}</span>
          <button className="button primary" onClick={run}>
            RUN HOSTED BACKTEST
          </button>
        </footer>
      </section>
      <section className="module">
        <header className="module-head">
          <div>
            <span className="section-label">PERFORMANCE SUMMARY</span>
            <p>
              Alpaca IEX historical OHLCV · deterministic assumptions shown
              above
            </p>
          </div>
        </header>
        <div className="hero-metrics">
          <FinancialMetric
            label="ENDING CAPITAL"
            value={cash(metrics.endingCapital ?? 0)}
            note="Historical simulation"
          />
          <FinancialMetric
            label="TOTAL RETURN"
            value={`${(metrics.totalReturnPct ?? 0).toFixed(2)}%`}
            note="Not a forecast"
          />
          <FinancialMetric
            label="WIN RATE"
            value={`${(metrics.winRate ?? 0).toFixed(1)}%`}
            note={`${metrics.totalTrades ?? 0} trades`}
          />
          <FinancialMetric
            label="PROFIT FACTOR"
            value={(metrics.profitFactor ?? 0).toFixed(2)}
            note="Gross wins / losses"
          />
          <FinancialMetric
            label="MAX DRAWDOWN"
            value={`${(metrics.maximumDrawdownPct ?? 0).toFixed(2)}%`}
            note={cash(metrics.maximumDrawdown ?? 0)}
          />
          <FinancialMetric
            label="SHARPE"
            value={(metrics.sharpeRatio ?? 0).toFixed(2)}
            note="Trade-return estimate"
          />
        </div>
        <BacktestCurve
          points={latest?.equity_curve ?? []}
          label="EQUITY CURVE"
          valueKey="equity"
        />
        <BacktestCurve
          points={latest?.drawdown_curve ?? []}
          label="DRAWDOWN"
          valueKey="drawdownPct"
        />
      </section>
      <section className="module recent">
        <header className="module-head">
          <div>
            <span className="section-label">SIMULATED TRADE HISTORY</span>
            <p>Analysis only · no broker orders</p>
          </div>
        </header>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "SYMBOL",
                  "STRATEGY",
                  "SIDE",
                  "ENTRY",
                  "EXIT",
                  "QTY",
                  "NET P/L",
                  "RETURN",
                  "REASON",
                ].map((item) => (
                  <th key={item}>{item}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(latest?.backtest_trades ?? []).map((trade, index) => (
                <tr key={index}>
                  <td>{String(trade.symbol)}</td>
                  <td>{String(trade.strategy)}</td>
                  <td>{String(trade.direction)}</td>
                  <td>{String(trade.entry_price)}</td>
                  <td>{String(trade.exit_price)}</td>
                  <td>{String(trade.quantity)}</td>
                  <td>{cash(Number(trade.net_pl))}</td>
                  <td>{Number(trade.return_pct).toFixed(2)}%</td>
                  <td>{String(trade.exit_reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="module">
        <header className="module-head">
          <div>
            <span className="section-label">
              HISTORICAL RUNS & STRATEGY COMPARISON
            </span>
            <p>
              Compare return, win rate, profit factor, drawdown, Sharpe, and
              trade count together.
            </p>
          </div>
        </header>
        {runs.map((item) => {
          const m = (item.metrics ?? {}) as Record<string, number>;
          return (
            <div className="health-item" key={String(item.id)}>
              <span>
                {String(item.strategy_name)} · {String(item.data_timeframe)}
              </span>
              <b>
                {String(item.status)} · Return{" "}
                {(m.totalReturnPct ?? 0).toFixed(2)}% · Win{" "}
                {(m.winRate ?? 0).toFixed(1)}% · PF{" "}
                {(m.profitFactor ?? 0).toFixed(2)} · DD{" "}
                {(m.maximumDrawdownPct ?? 0).toFixed(2)}% · Sharpe{" "}
                {(m.sharpeRatio ?? 0).toFixed(2)} · {m.totalTrades ?? 0} trades
              </b>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function BacktestCurve({
  points,
  label,
  valueKey,
}: {
  points: Array<Record<string, number | string>>;
  label: string;
  valueKey: string;
}) {
  const values = points.map((point) => Number(point[valueKey] ?? 0));
  const min = Math.min(...values, 0),
    max = Math.max(...values, 1),
    span = Math.max(1, max - min);
  const path = values
    .map(
      (value, index) =>
        `${index ? "L" : "M"} ${(index / Math.max(1, values.length - 1)) * 100} ${38 - ((value - min) / span) * 36}`,
    )
    .join(" ");
  return (
    <div className="portfolio-chart">
      <span className="section-label">{label}</span>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

function RiskSettingsWorkspace({ initial }: { initial: RiskSettings }) {
  const [settings, setSettings] = useState(initial),
    [status, setStatus] = useState(""),
    [saving, setSaving] = useState(false);
  const fields: Array<[keyof RiskSettings, string, string]> = [
    ["maximumCapitalPerTrade", "MAX CAPITAL / TRADE", "$"],
    ["maximumRiskPerTrade", "MAX LOSS / TRADE", "$"],
    ["dailyMaximumLoss", "DAILY MAXIMUM LOSS", "$"],
    ["dailyProfitTarget", "DAILY PROFIT TARGET", "$"],
    ["maximumTradesPerDay", "MAX TRADES / DAY", "count"],
    ["maximumConcurrentPositions", "MAX CONCURRENT POSITIONS", "count"],
    ["maximumPortfolioExposure", "MAX PORTFOLIO EXPOSURE", "%"],
    ["maximumExposurePerAsset", "MAX EXPOSURE / ASSET", "%"],
    ["maximumPortfolioDrawdown", "MAX PORTFOLIO DRAWDOWN", "%"],
    ["autoTraderAllocatedCapital", "AUTO TRADER ALLOCATION", "$"],
    ["bigMoneyApprovalThreshold", "BIG MONEY APPROVAL SCORE", "/100"],
  ];
  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/risk/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const result = (await response.json()) as { error?: string };
      setStatus(response.ok ? "PAPER risk settings saved." : result.error!);
    } catch {
      setStatus("Risk settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="risk-settings-workspace">
      <section className="module risk-settings-panel">
        <header className="module-head">
          <div>
            <span className="section-label">PRODUCTION RISK MANAGER</span>
            <p>Owner-configurable PAPER trading boundaries</p>
          </div>
          <StatusBadge status="PAPER ONLY" />
        </header>
        <div className="risk-settings-grid">
          {fields.map(([key, label, suffix]) => (
            <label key={key}>
              <span>{label}</span>
              <div>
                <input
                  aria-label={label}
                  type="number"
                  min="0"
                  max={suffix === "%" || suffix === "/100" ? 100 : undefined}
                  step={suffix === "%" ? "0.1" : "1"}
                  value={settings[key] as number}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      [key]: Number(event.target.value),
                    })
                  }
                />
                <b>{suffix}</b>
              </div>
            </label>
          ))}
        </div>
        <div className="risk-callout">
          <b>DAILY LOCKS DO NOT CLOSE POSITIONS</b>
          <span>
            New automated positions stop; existing PAPER positions remain
            managed.
          </span>
        </div>
        <footer className="risk-settings-actions">
          <span role="status">{status}</span>
          <button className="button primary" disabled={saving} onClick={save}>
            {saving ? "SAVING…" : "SAVE PAPER RISK SETTINGS"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Dashboard(p: {
  range: string;
  setRange: (v: string) => void;
  auto: AutoState;
  locked: boolean;
  rec: TradeRecommendation;
  setRec: (r: TradeRecommendation) => void;
  investment: number;
  setInvestment: (n: number) => void;
  setModal: (m: Modal) => void;
  approve: () => void;
  reject: () => void;
  emergency: () => void;
  pause: () => void;
  resume: () => void;
  openPosition: (p: (typeof positions)[0]) => void;
  broker: BrokerDashboardData;
  persistence: DashboardPersistence;
  livePositions: typeof positions;
  portfolio: HostedPortfolio;
}) {
  const liveInvested = p.livePositions.reduce(
    (sum, position) =>
      sum + Number(position.size.replace(/[$,]/g, "")) + position.pnl,
    0,
  );
  const liveProfitLoss =
    p.portfolio.account?.unrealized_pl ??
    p.livePositions.reduce((sum, position) => sum + position.pnl, 0);
  const availableCash =
    p.portfolio.account?.cash ?? p.broker.summary?.availableCash ?? 48860.42;
  const livePortfolioValue =
    p.portfolio.account?.equity ?? availableCash + liveInvested;
  return (
    <>
      <section className="hero-grid">
        <div className="portfolio-hero">
          <div className="hero-copy">
            <span className="section-label">
              TOTAL PORTFOLIO{" "}
              <em>
                {p.portfolio.source === "ALPACA_PAPER"
                  ? "ALPACA PAPER DATA"
                  : "DEMO DATA"}
              </em>
            </span>
            <div className="hero-value">
              {p.broker.marketDataSource === "ALPACA — IEX"
                ? cash(livePortfolioValue)
                : p.broker.summary?.netLiquidation != null
                  ? cash(p.broker.summary.netLiquidation)
                  : "$84,260.42"}
            </div>
            <div className="hero-change positive">
              <b>
                {liveProfitLoss >= 0 ? "↗ +" : "↘ "}
                {cash(liveProfitLoss)}
              </b>
              <span>Open-position unrealized P/L</span>
            </div>
            <div className="hero-metrics">
              <FinancialMetric
                label="TOTAL P/L"
                value={`${liveProfitLoss >= 0 ? "↗ +" : "↘ "}${cash(liveProfitLoss)}`}
                note="Current marked positions"
                tone={liveProfitLoss >= 0 ? "positive" : "negative"}
              />
              <FinancialMetric
                label="AVAILABLE CASH"
                value={
                  p.broker.summary?.availableCash != null
                    ? cash(p.broker.summary.availableCash)
                    : "$48,860.42"
                }
                note="58.0% liquid"
              />
              <FinancialMetric
                label="BUYING POWER"
                value={cash(p.portfolio.account?.buying_power ?? 0)}
                note="Alpaca PAPER"
              />
            </div>
            <div className="hero-metrics">
              <FinancialMetric
                label="TODAY'S REALIZED P/L"
                value={cash(p.portfolio.account?.realized_pl_today ?? 0)}
                note="Broker portfolio history"
              />
              <FinancialMetric
                label="OPEN EXPOSURE"
                value={cash(p.portfolio.account?.open_exposure ?? liveInvested)}
                note="Absolute market value"
              />
              <FinancialMetric
                label="POSITION COUNT"
                value={String(
                  p.portfolio.account?.position_count ?? p.livePositions.length,
                )}
                note="Open PAPER positions"
              />
            </div>
          </div>
          <PortfolioChart range={p.range} setRange={p.setRange} />
        </div>
        <MarketOverview />
      </section>
      <div className="dashboard-grid">
        <div className="primary-column">
          <AutoTrader
            auto={p.auto}
            locked={p.locked}
            pause={p.pause}
            resume={p.resume}
          />
          <RecentTrades fills={p.portfolio.fills} />
          <RecommendationCard
            rec={p.rec}
            locked={p.locked}
            approve={p.approve}
            reject={p.reject}
            analysis={() => p.setModal("analysis")}
            modify={() => p.setModal("modify")}
          />
          <PositionTable rows={p.livePositions} open={p.openPosition} />
        </div>
        <aside className="right-column">
          <RiskCard
            locked={p.locked}
            emergency={p.emergency}
            reset={() => p.setModal("reset")}
          />
          <SystemHealth broker={p.broker} persistence={p.persistence} />
          <Allocation />
        </aside>
      </div>
    </>
  );
}

function FinancialMetric({
  label,
  value,
  note,
  tone = "",
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="financial-metric">
      <span>{label}</span>
      <b className={tone}>{value}</b>
      <small>{note}</small>
    </div>
  );
}
function PnL({ value, pct }: { value: number; pct?: number }) {
  return (
    <span className={`pnl ${value >= 0 ? "positive" : "negative"}`}>
      {value >= 0 ? "↗ +" : "↘ −"}${Math.abs(value).toFixed(2)}
      {pct !== undefined && (
        <small>
          {" "}
          {value >= 0 ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%
        </small>
      )}
    </span>
  );
}
function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`status-badge ${status.toLowerCase().replaceAll(" ", "-")}`}
    >
      <i />
      {status}
    </span>
  );
}
function DirectionBadge({ direction }: { direction: string }) {
  return (
    <span className={`direction ${direction.toLowerCase()}`}>
      {direction === "BUY" ? "↑" : "↓"} {direction}
    </span>
  );
}
function PortfolioChart({
  range,
  setRange,
}: {
  range: string;
  setRange: (v: string) => void;
}) {
  const data = ranges[range],
    points = data
      .map((v, i) => `${(i / (data.length - 1)) * 100},${70 - v}`)
      .join(" ");
  return (
    <div className="chart-panel">
      <div className="chart-top">
        <div>
          <span>PORTFOLIO PERFORMANCE</span>
          <b>
            +$3,142.80 <small>+3.87%</small>
          </b>
        </div>
        <div className="ranges">
          {Object.keys(ranges).map((r) => (
            <button
              key={r}
              className={range === r ? "active" : ""}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`${range} portfolio chart trending upward`}
      >
        <div className="chart-grid" />
        <svg viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4d8cff" stopOpacity=".32" />
              <stop offset="1" stopColor="#4d8cff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,70 ${points} 100,70`} fill="url(#area)" />
          <polyline
            points={points}
            fill="none"
            stroke="#66a0ff"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="100" cy={70 - data.at(-1)!} r="1.6" fill="#8bb7ff" />
        </svg>
        <div className="chart-tooltip">
          $84,260.42<small>AUG 13</small>
        </div>
      </div>
    </div>
  );
}
function MarketOverview() {
  return (
    <div className="market-card">
      <header>
        <div>
          <span className="section-label">MARKET OVERVIEW</span>
          <small>DEMO DATA · DELAYED</small>
        </div>
        <button aria-label="More market data">•••</button>
      </header>
      {markets.map((m) => (
        <div className="market-row" key={m.n}>
          <span>{m.n}</span>
          <b>{m.v}</b>
          <em className={m.p >= 0 ? "positive" : "negative"}>
            {m.p >= 0 ? "↗ +" : "↘ "}
            {m.p}%
          </em>
        </div>
      ))}
    </div>
  );
}
function AutoTrader({
  auto,
  locked,
  pause,
  resume,
}: {
  auto: AutoState;
  locked: boolean;
  pause: () => void;
  resume: () => void;
}) {
  return (
    <section className="module auto-module">
      <header className="module-head">
        <div>
          <span className="section-label">AUTO TRADER</span>
          <p>Rules-based paper execution</p>
        </div>
        <StatusBadge status={auto} />
      </header>
      <div className="auto-body">
        <div className="auto-stats">
          <FinancialMetric
            label="TODAY'S P/L"
            value="↗ +$384.20"
            note="3 closed trades"
            tone="positive"
          />
          <FinancialMetric label="TRADES" value="3 / 8" note="5 remaining" />
          <FinancialMetric label="DEPLOYED" value="$8,500" note="of $25,000" />
          <FinancialMetric
            label="WIN / LOSS"
            value="2 / 1"
            note="66.7% win rate"
          />
        </div>
        <div className="risk-progress">
          <RiskProgress
            label="Daily profit target"
            value="$384 / $1,000"
            pct={38.4}
            tone="gain"
          />
          <RiskProgress
            label="Daily loss limit"
            value="$126 / $750"
            pct={16.8}
            tone="loss"
          />
          <div className="limits">
            <span>
              MAX TRADE <b>$2,500</b>
            </span>
            <span>
              ALLOCATED <b>$25,000</b>
            </span>
          </div>
        </div>
      </div>
      <footer>
        <span>
          <i /> Monitoring 12 strategies
        </span>
        {auto === "ACTIVE" ? (
          <button className="button pause" onClick={pause}>
            Ⅱ PAUSE AUTO TRADER
          </button>
        ) : (
          <button className="button primary" disabled={locked} onClick={resume}>
            ▶ RESUME AUTO TRADER
          </button>
        )}
      </footer>
    </section>
  );
}
function RiskProgress({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct: number;
  tone: string;
}) {
  return (
    <div className="risk-progress-item">
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="progress">
        <i className={tone} style={{ width: `${pct}%` }} />
      </div>
      <small>{pct.toFixed(0)}% of limit</small>
    </div>
  );
}
function RecentTrades({ fills }: { fills: HostedPortfolio["fills"] }) {
  const demoRows = [
    ["14:32", "NVDA", "BUY", "$2,100", "WIN", "+$82.40", "Momentum V2"],
    ["12:18", "MSFT", "BUY", "$1,850", "WIN", "+$46.10", "Quality Breakout"],
    ["10:06", "EUR/USD", "SELL", "$1,600", "LOSS", "−$26.30", "FX Trend"],
  ];
  const rows = fills.length
    ? fills.map((fill) => [
        new Date(String(fill.executed_at)).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        String(fill.symbol),
        String(fill.side),
        cash(Number(fill.quantity) * Number(fill.price)),
        "FILLED",
        "—",
        String(fill.strategy_name ?? "Alpaca PAPER"),
      ])
    : demoRows;
  return (
    <section className="module recent">
      <header className="module-head">
        <div>
          <span className="section-label">RECENT AUTOMATED ACTIVITY</span>
          <p>Today · Paper trades</p>
        </div>
        <button className="text-button">VIEW ALL →</button>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "TIME",
                "SYMBOL",
                "DIRECTION",
                "SIZE",
                "RESULT",
                "P/L",
                "STRATEGY",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((x, i) => (
                  <td
                    key={i}
                    className={
                      x.includes("+")
                        ? "positive"
                        : x.includes("−")
                          ? "negative"
                          : ""
                    }
                  >
                    {i === 2 ? (
                      <DirectionBadge direction={x} />
                    ) : i === 4 ? (
                      <StatusBadge status={x} />
                    ) : (
                      x
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function RecommendationCard({
  rec,
  locked,
  approve,
  reject,
  analysis,
  modify,
}: {
  rec: TradeRecommendation;
  locked: boolean;
  approve: () => void;
  reject: () => void;
  analysis: () => void;
  modify: () => void;
}) {
  return (
    <section className="module recommendation">
      <header className="module-head">
        <div>
          <span className="section-label">BIG MONEY OPPORTUNITY</span>
          <p>Owner approval required · Demo research</p>
        </div>
        <StatusBadge status={rec.status} />
      </header>
      <div className="rec-main">
        <div className="rec-identity">
          <div className="symbol-icon">A</div>
          <div>
            <h2>
              AAPL <DirectionBadge direction="BUY" />
            </h2>
            <p>Apple Inc. · NASDAQ</p>
          </div>
        </div>
        <div className="strategy-score">
          <strong>{rec.score}</strong>
          <span>/100</span>
          <small>STRATEGY SCORE*</small>
        </div>
        <div className="rec-metrics">
          <FinancialMetric
            label="MARKET PRICE"
            value="$227.42"
            note="Market quote"
          />
          <FinancialMetric
            label="INVESTMENT"
            value={cash(rec.investment)}
            note="Suggested"
          />
          <FinancialMetric
            label="MAX LOSS"
            value="−$280"
            note="5.6% of position"
            tone="negative"
          />
          <FinancialMetric
            label="TARGET"
            value="$248.50"
            note="+9.27% upside"
            tone="positive"
          />
          <FinancialMetric
            label="RISK / REWARD"
            value="1 : 2.7"
            note="Favorable"
          />
          <FinancialMetric
            label="CONDITION"
            value="BULLISH"
            note="Consolidation"
            tone="positive"
          />
        </div>
        <div className="research-summary">
          <span>MODEL RESEARCH SUMMARY</span>
          <p>
            Strong relative momentum and improving institutional volume support
            a continuation setup above the 20-day range. Fundamentals remain
            resilient; near-term volatility is contained.
          </p>
          <small>
            Generated 22 minutes ago · Scores are model indicators, not
            probability of profit.
          </small>
        </div>
      </div>
      {rec.status === "APPROVED" && (
        <div className="approved-note">
          ✓ APPROVED — EXECUTION ENGINE NOT CONNECTED
        </div>
      )}
      <footer className="rec-actions">
        <button className="button" onClick={analysis}>
          VIEW ANALYSIS
        </button>
        <button className="button" onClick={modify}>
          MODIFY
        </button>
        <span />
        <button
          className="button reject"
          disabled={rec.status !== "PENDING"}
          onClick={reject}
        >
          REJECT
        </button>
        <button
          className="button primary"
          disabled={rec.status !== "PENDING" || locked}
          onClick={approve}
        >
          APPROVE · PAPER ONLY
        </button>
      </footer>
    </section>
  );
}
function PositionTable({
  rows,
  open,
}: {
  rows: typeof positions;
  open: (p: (typeof positions)[0]) => void;
}) {
  return (
    <section className="module position-module">
      <header className="module-head">
        <div>
          <span className="section-label">OPEN POSITIONS</span>
          <p>{rows.length} positions · synchronized PAPER exposure</p>
        </div>
        <button className="text-button">VIEW PORTFOLIO →</button>
      </header>
      <div className="table-scroll">
        <table className="position-table">
          <thead>
            <tr>
              {[
                "ASSET",
                "DIRECTION",
                "ENTRY",
                "CURRENT",
                "POSITION SIZE",
                "STOP",
                "TARGET",
                "P/L",
                "P/L %",
                "STRATEGY",
                "STATUS",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr
                key={x.symbol}
                tabIndex={0}
                onClick={() => open(x)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") open(x);
                }}
              >
                <td>
                  <b>{x.symbol}</b>
                  <small>{x.name}</small>
                </td>
                <td>
                  <DirectionBadge direction={x.direction} />
                </td>
                <td>{x.entry}</td>
                <td>{x.current}</td>
                <td>{x.size}</td>
                <td>{x.stop}</td>
                <td>{x.target}</td>
                <td>
                  <PnL value={x.pnl} />
                </td>
                <td className={x.pct >= 0 ? "positive" : "negative"}>
                  {x.pct >= 0 ? "↗ +" : "↘ "}
                  {x.pct}%
                </td>
                <td>{x.strategy}</td>
                <td>
                  <StatusBadge status={x.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-positions">
        {rows.map((x) => (
          <button key={x.symbol} onClick={() => open(x)}>
            <div>
              <b>{x.symbol}</b>
              <small>{x.name}</small>
            </div>
            <DirectionBadge direction={x.direction} />
            <span>{x.current}</span>
            <PnL value={x.pnl} pct={x.pct} />
          </button>
        ))}
      </div>
    </section>
  );
}
function RiskCard({
  locked,
  emergency,
  reset,
}: {
  locked: boolean;
  emergency: () => void;
  reset: () => void;
}) {
  return (
    <section className={`module risk-card ${locked ? "is-locked" : ""}`}>
      <header className="module-head">
        <div>
          <span className="section-label">RISK MANAGER</span>
          <p>Central permission layer</p>
        </div>
        <StatusBadge status={locked ? "LOCKED" : "NORMAL"} />
      </header>
      <div className="risk-gauge">
        <div>
          <b>{locked ? "LOCKED" : "2.1%"}</b>
          <span>PORTFOLIO DRAWDOWN</span>
        </div>
      </div>
      <RiskProgress
        label="Daily maximum loss"
        value="$126 / $750"
        pct={16.8}
        tone="loss"
      />
      <RiskProgress
        label="Portfolio drawdown"
        value="2.1% / 12%"
        pct={17.5}
        tone="neutral"
      />
      <div className="risk-grid">
        <FinancialMetric label="EXPOSURE" value="16.5%" note="$13,900" />
        <FinancialMetric
          label="CONCURRENT"
          value="4 / 4"
          note="At limit"
          tone="warning"
        />
      </div>
      <div className="risk-callout">
        <b>✓ ALL SAFETY RULES ENFORCED</b>
        <span>No limit breaches detected</span>
      </div>
      <button className="emergency" onClick={locked ? reset : emergency}>
        {locked ? "RESET EMERGENCY STOP" : "⏻ EMERGENCY STOP"}
      </button>
      <small className="emergency-note">
        Immediately blocks all automated actions and approvals
      </small>
    </section>
  );
}
function SystemHealth({
  broker,
  persistence,
}: {
  broker: BrokerDashboardData;
  persistence: DashboardPersistence;
}) {
  const brokerState =
    broker.status === "PAPER_CONNECTED"
      ? "on"
      : broker.status === "ERROR"
        ? "off"
        : "warn";
  const items = [
    ["Web", "ONLINE", "on"],
    [
      "Trading Engine",
      persistence.workerStatus,
      persistence.workerStatus === "ONLINE" ? "on" : "off",
    ],
    [
      "Broker",
      `${broker.brokerProvider} / ${broker.status.replaceAll("_", " ")}`,
      brokerState,
    ],
    [
      "Market Data",
      `${broker.marketDataSource} / ${broker.marketDataStatus.replaceAll("_", " ")}`,
      broker.marketDataStatus === "MARKET_DATA_ACTIVE"
        ? "on"
        : broker.marketDataStatus === "ERROR"
          ? "off"
          : "warn",
    ],
    ["Risk Manager", "ACTIVE", "on"],
    [
      "Database",
      persistence.databaseStatus === "CONNECTED" ? "CONNECTED" : "LOCAL / DEMO",
      persistence.databaseStatus === "CONNECTED" ? "on" : "warn",
    ],
    ["Notifications", "NOT CONNECTED", "off"],
    ["Trading Mode", "PAPER / LIVE LOCKED", "on"],
    ["Runtime", broker.runtime, broker.runtime === "Hosted" ? "on" : "warn"],
  ];
  return (
    <section className="module health">
      <header className="module-head">
        <div>
          <span className="section-label">SYSTEM HEALTH</span>
          <p>Infrastructure status</p>
        </div>
        <span className="pulse" />
      </header>
      {items.map(([a, b, c]) => (
        <SystemHealthItem key={a} label={a} value={b} state={c} />
      ))}
    </section>
  );
}

function BrokerWorkspace({
  broker,
  locked,
}: {
  broker: BrokerDashboardData;
  locked: boolean;
}) {
  const [symbol, setSymbol] = useState("AAPL"),
    [direction, setDirection] = useState<"BUY" | "SELL">("BUY"),
    [quantity, setQuantity] = useState(1),
    [type, setType] = useState<"MARKET" | "LIMIT">("MARKET"),
    [limitPrice, setLimitPrice] = useState(227.42),
    [stopLoss, setStopLoss] = useState(220),
    [confirming, setConfirming] = useState(false),
    [status, setStatus] = useState("READY"),
    [message, setMessage] = useState(""),
    [clientOrderId, setClientOrderId] = useState(() => crypto.randomUUID());
  const submit = async () => {
    setStatus("SUBMITTED");
    setMessage("");
    try {
      const response = await fetch("/api/broker/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          direction,
          quantity,
          type,
          limitPrice: type === "LIMIT" ? limitPrice : undefined,
          stopLoss,
          source: "MANUAL",
          mode: "PAPER",
          confirmed: true,
          clientOrderId,
        }),
      });
      const data = (await response.json()) as {
        status?: string;
        message?: string;
        code?: string;
      };
      setStatus(data.status ?? "REJECTED");
      setMessage(data.message ?? data.code ?? "Paper order rejected.");
      if (response.ok) setClientOrderId(crypto.randomUUID());
    } catch {
      setStatus("ERROR");
      setMessage("Paper broker request failed safely.");
    } finally {
      setConfirming(false);
    }
  };
  return (
    <div className="broker-workspace">
      <section className="module broker-panel">
        <header className="module-head">
          <div>
            <span className="section-label">BROKER CONNECTION</span>
            <p>Server-only paper adapter</p>
          </div>
          <StatusBadge status={broker.status.replaceAll("_", " ")} />
        </header>
        <div className="broker-details">
          <FinancialMetric
            label="PROVIDER"
            value={broker.brokerProvider}
            note={
              broker.adapter === "ALPACA_PAPER"
                ? "Cloud-native Trading API"
                : broker.adapter === "IBKR_TWS_LOCAL"
                  ? "IB Gateway / TWS API"
                  : "Client Portal Gateway · local only"
            }
          />
          <FinancialMetric
            label="RUNTIME"
            value={broker.runtime}
            note={
              broker.runtime === "Hosted"
                ? "Zero local-machine dependency"
                : "Development runtime"
            }
          />
          <FinancialMetric
            label="ENVIRONMENT"
            value="PAPER"
            note="Hard locked"
            tone="positive"
          />
          <FinancialMetric
            label="ACCOUNT ID"
            value={broker.summary?.accountIdMasked ?? "NOT AVAILABLE"}
            note="Always masked"
          />
          <FinancialMetric
            label="LAST SYNC"
            value={
              broker.summary?.lastSuccessfulSync
                ? new Date(
                    broker.summary.lastSuccessfulSync,
                  ).toLocaleTimeString()
                : "NEVER"
            }
            note={
              broker.source === "ALPACA_PAPER"
                ? "ALPACA — PAPER"
                : broker.source === "IBKR_PAPER"
                  ? broker.marketDataDelayed
                    ? "IBKR PAPER — DELAYED"
                    : "IBKR PAPER DATA"
                  : "DEMO fallback active"
            }
          />
        </div>
        {broker.lastError && (
          <div className="broker-error">{broker.lastError}</div>
        )}
        {broker.localOnlyWarning && (
          <div className="broker-error">{broker.localOnlyWarning}</div>
        )}
        <div className="paper-warning">
          Credentials, session cookies, usernames, passwords, and account
          numbers are never stored by this application.
        </div>
      </section>
      <section className="module order-ticket">
        <header className="module-head">
          <div>
            <span className="section-label">PAPER ORDER TICKET</span>
            <p>Trade Permission → Risk Manager → Paper Broker Adapter → IBKR</p>
          </div>
          <span className="paper-trade-label">PAPER TRADE — NO REAL MONEY</span>
        </header>
        <div className="ticket-grid">
          <label>
            SYMBOL
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              maxLength={12}
            />
          </label>
          <label>
            DIRECTION
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "BUY" | "SELL")}
            >
              <option>BUY</option>
              <option>SELL</option>
            </select>
          </label>
          <label>
            QUANTITY
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            ORDER TYPE
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "MARKET" | "LIMIT")}
            >
              <option value="MARKET">MARKET</option>
              <option value="LIMIT">LIMIT</option>
            </select>
          </label>
          {type === "LIMIT" && (
            <label>
              LIMIT PRICE
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(Number(e.target.value))}
              />
            </label>
          )}
          <label>
            STOP LOSS
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={stopLoss}
              onChange={(e) => setStopLoss(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="ticket-state">
          <b>STATUS: {status}</b>
          {message && <span>{message}</span>}
        </div>
        <button
          className="button primary ticket-submit"
          disabled={locked || broker.status !== "PAPER_CONNECTED"}
          onClick={() => setConfirming(true)}
        >
          REVIEW PAPER ORDER
        </button>
        {broker.status !== "PAPER_CONNECTED" && (
          <p className="ticket-help">
            Connect an authenticated IBKR paper gateway before submitting. Demo
            data remains active.
          </p>
        )}
      </section>
      {confirming && (
        <div
          className="confirm-order"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm paper order"
        >
          <div>
            <span className="section-label">
              EXPLICIT CONFIRMATION REQUIRED
            </span>
            <h2>PAPER TRADE — NO REAL MONEY</h2>
            <p>
              {direction} {quantity} {symbol.toUpperCase()} as a {type}
              {type === "LIMIT" ? ` order at ${limitPrice}` : " order"}.
            </p>
            <div className="paper-warning">
              This request will pass through TradePermissionService and Risk
              Manager before reaching the IBKR PAPER adapter.
            </div>
            <footer>
              <button className="button" onClick={() => setConfirming(false)}>
                CANCEL
              </button>
              <button className="button primary" onClick={submit}>
                CONFIRM PAPER ORDER
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
function SystemHealthItem({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: string;
}) {
  return (
    <div className="health-row">
      <span>
        <i className={state} />
        {label}
      </span>
      <b className={state}>{value}</b>
    </div>
  );
}
function Allocation() {
  return (
    <section className="module allocation">
      <header className="module-head">
        <div>
          <span className="section-label">CAPITAL ALLOCATION</span>
          <p>Paper portfolio</p>
        </div>
      </header>
      <div className="donut">
        <span>
          $84.3K<small>TOTAL</small>
        </span>
      </div>
      <div className="legend">
        <span>
          <i className="cash" />
          Cash <b>58%</b>
        </span>
        <span>
          <i className="equity" />
          Equities <b>25%</b>
        </span>
        <span>
          <i className="forex" />
          Forex <b>9%</b>
        </span>
        <span>
          <i className="metal" />
          Metals <b>8%</b>
        </span>
      </div>
    </section>
  );
}
function ModalFrame({
  title,
  close,
  children,
  refEl,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  refEl: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={refEl}
      >
        <header>
          <div>
            <span className="section-label">PAPER RESEARCH · DEMO</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button aria-label="Close dialog" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function RecommendationDetail({
  rec,
  option,
  setOption,
  investment,
  setInvestment,
  modifying,
  approve,
  reject,
  locked,
}: {
  rec: TradeRecommendation;
  option: string;
  setOption: (x: string) => void;
  investment: number;
  setInvestment: (x: number) => void;
  modifying: boolean;
  approve: () => void;
  reject: () => void;
  locked: boolean;
}) {
  return (
    <div className="modal-content">
      <div className="detail-summary">
        <div className="rec-identity">
          <div className="symbol-icon">A</div>
          <div>
            <h2>
              AAPL <DirectionBadge direction="BUY" />
            </h2>
            <p>Apple Inc. · NASDAQ · Market quote $227.42</p>
          </div>
        </div>
        <div className="strategy-score">
          <strong>91</strong>
          <span>/100</span>
          <small>MODEL SCORE*</small>
        </div>
      </div>
      <div className="overview-grid">
        <FinancialMetric
          label="ENTRY"
          value="$227.42"
          note="Market reference"
        />
        <FinancialMetric
          label="INVESTMENT"
          value={cash(investment)}
          note="Owner editable"
        />
        <FinancialMetric
          label="STOP"
          value="$218.40"
          note="−3.97%"
          tone="negative"
        />
        <FinancialMetric
          label="TARGET"
          value="$248.50"
          note="+9.27%"
          tone="positive"
        />
        <FinancialMetric
          label="RISK / REWARD"
          value="1 : 2.7"
          note="Recommended"
        />
      </div>
      {modifying && (
        <label className="investment-input">
          RECOMMENDED INVESTMENT
          <input
            aria-label="Recommended investment"
            type="number"
            min="500"
            step="100"
            value={investment}
            onChange={(e) => setInvestment(Number(e.target.value))}
          />
          <small>Paper allocation only. No order will be placed.</small>
        </label>
      )}
      <h3>
        RESEARCH BREAKDOWN{" "}
        <small>*Model indicators, not probability of profit</small>
      </h3>
      <div className="score-list">
        {scores.map((s) => (
          <div key={s.n}>
            <span>{s.n}</span>
            <div>
              <i style={{ width: `${s.v}%` }} />
            </div>
            <b>{s.v}</b>
          </div>
        ))}
      </div>
      <h3>RISK OPTIONS</h3>
      <div className="risk-options">
        {[
          ["Conservative", "$180", "Tighter exposure"],
          ["Recommended", "$280", "Balanced profile"],
          ["Aggressive", "$420", "Wider tolerance"],
        ].map(([a, b, c]) => (
          <button
            key={a}
            className={option === a ? "active" : ""}
            onClick={() => setOption(a)}
          >
            <span>{a}</span>
            <b>{b}</b>
            <small>{c}</small>
          </button>
        ))}
      </div>
      <div className="research-full">
        <b>RESEARCH SUMMARY</b>
        <p>
          Price is consolidating above key moving averages while relative
          strength remains constructive. Volume quality has improved across
          three sessions. Fundamentals and news tone are supportive, though
          upcoming macro data may increase short-term volatility.
        </p>
      </div>
      <div className="paper-warning">
        ⓘ PAPER APPROVAL ONLY — NO BROKER OR EXECUTION ENGINE IS CONNECTED
      </div>
      <footer className="modal-actions">
        <button className="button reject" onClick={reject}>
          REJECT
        </button>
        <button className="button" onClick={() => {}}>
          MODIFY
        </button>
        <button
          className="button primary"
          disabled={locked || rec.status !== "PENDING"}
          onClick={approve}
        >
          APPROVE · PAPER ONLY
        </button>
      </footer>
    </div>
  );
}
function PositionDetail({ p }: { p: (typeof positions)[0] }) {
  return (
    <div className="modal-content">
      <div className="detail-summary">
        <div className="rec-identity">
          <div className="symbol-icon">{p.symbol[0]}</div>
          <div>
            <h2>
              {p.symbol} <DirectionBadge direction={p.direction} />
            </h2>
            <p>{p.name} · PAPER POSITION</p>
          </div>
        </div>
        <PnL value={p.pnl} pct={p.pct} />
      </div>
      <div className="overview-grid">
        <FinancialMetric label="ENTRY" value={p.entry} note="Paper fill" />
        <FinancialMetric
          label="CURRENT"
          value={p.current}
          note="Market quote"
        />
        <FinancialMetric
          label="POSITION SIZE"
          value={p.size}
          note="Capital deployed"
        />
        <FinancialMetric label="STOP" value={p.stop} note="Risk control" />
        <FinancialMetric
          label="TARGET"
          value={p.target}
          note="Position objective"
        />
      </div>
      <div className="research-full">
        <b>POSITION MANAGEMENT</b>
        <p>
          Strategy: {p.strategy}. This position is shown for demonstration only.
          Position-management automation and broker execution are not connected.
        </p>
      </div>
    </div>
  );
}
function ResetModal({
  reset,
  close,
}: {
  reset: () => void;
  close: () => void;
}) {
  return (
    <div className="modal-content reset-content">
      <div className="stop-icon">⏻</div>
      <p>
        Resetting unlocks the central permission layer. Auto Trader will remain
        paused and must be resumed separately.
      </p>
      <div className="paper-warning danger">
        This confirmation does not enable LIVE trading.
      </div>
      <footer className="modal-actions">
        <button className="button" onClick={close}>
          KEEP SYSTEM LOCKED
        </button>
        <button className="button reject" onClick={reset}>
          CONFIRM RESET
        </button>
      </footer>
    </div>
  );
}
