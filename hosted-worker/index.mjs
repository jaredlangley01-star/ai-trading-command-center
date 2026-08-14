import { createClient } from "@supabase/supabase-js";
import { ProtectiveExitService } from "../src/services/broker/protective-exit-service.ts";
import { fetchAlpacaHistoricalBars } from "../src/services/backtesting/historical-data.ts";
import { runHistoricalBacktest } from "../src/services/backtesting/engine.ts";
import {
  defaultStrategies,
  combineStrategySignals,
} from "../src/services/strategies/combined-opportunity-engine.ts";
import {
  fetchAlpacaNews,
  fetchCorporateActions,
  fetchSecBundle,
  normalizeSecFacts,
  normalizeSecFilings,
} from "../src/services/intelligence/sources.ts";
import { analyzeNews } from "../src/services/intelligence/analysis.ts";
import { buildIntelligenceSnapshot } from "../src/services/intelligence/engine.ts";
import { OpenAIResponsesResearchProvider } from "../src/services/intelligence/ai-provider.ts";

const PAPER_URL = "https://paper-api.alpaca.markets";
const DATA_URL = "https://data.alpaca.markets";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALPACA_BROKER_API_KEY",
  "ALPACA_BROKER_API_SECRET",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
];
for (const name of required)
  if (!process.env[name]) throw new Error(`MISSING_ENV:${name}`);
if (process.env.TRADING_RUNTIME_MODE !== "HOSTED_PRODUCTION")
  throw new Error("HOSTED_PRODUCTION_REQUIRED");
if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_ENVIRONMENT ?? "PAPER") !== "PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_BASE_URL ?? PAPER_URL) !== PAPER_URL)
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_DATA_FEED ?? "iex").toLowerCase() !== "iex")
  throw new Error("IEX_FEED_REQUIRED");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const workerId = process.env.WORKER_ID ?? "railway-trading-engine";
const intervalMs = Math.max(
  10_000,
  Number(process.env.WORKER_INTERVAL_MS ?? 30_000),
);
const symbols = (process.env.WORKER_SCAN_SYMBOLS ?? "AAPL,MSFT,NVDA,SPY")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const headers = (key, secret) => ({
  "APCA-API-KEY-ID": key,
  "APCA-API-SECRET-KEY": secret,
});
const brokerHeaders = () =>
  headers(
    process.env.ALPACA_BROKER_API_KEY,
    process.env.ALPACA_BROKER_API_SECRET,
  );
let stopping = false;

async function json(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
  return response.status === 204 ? null : response.json();
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const masked = (value) => {
  const text = String(value ?? "");
  return text.length > 4 ? `****${text.slice(-4)}` : "****";
};

async function submitProtectivePaperExit(ownerId, position, reason) {
  if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
    throw new Error("LIVE_TRADING_LOCKED");
  if ((process.env.ALPACA_BROKER_BASE_URL ?? PAPER_URL) !== PAPER_URL)
    throw new Error("LIVE_TRADING_LOCKED");
  const quantity = Math.abs(number(position.qty));
  if (!quantity) return;
  const clientOrderId = `protective:${ownerId}:${position.asset_id}`;
  const claim = {
    user_id: ownerId,
    broker_position_id: String(position.asset_id),
    reason,
    client_order_id: clientOrderId,
    status: "CLAIMED",
    trigger_price: number(position.current_price),
  };
  const { error: claimError } = await db
    .from("paper_position_exit_claims")
    .insert(claim);
  if (claimError) return; // Unique claim means another cycle/restart owns the exit.
  try {
    const brokerAdapter = {
      submitPaperOrder: async (order) => {
        const response = await json(`${PAPER_URL}/v2/orders`, {
          method: "POST",
          headers: { ...brokerHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            symbol: order.symbol,
            qty: String(order.quantity),
            side: order.direction.toLowerCase(),
            type: "market",
            time_in_force: "day",
            client_order_id: order.clientOrderId,
          }),
        });
        return {
          brokerOrderId: String(response.id),
          status: "ACCEPTED",
          message: "Alpaca PAPER protective exit accepted.",
          mode: "PAPER",
        };
      },
    };
    const exitService = new ProtectiveExitService(brokerAdapter, {
      mode: "PAPER",
      autoTraderStatus: "PAUSED",
      riskState: "LOCKED",
      emergencyStopActive: true,
    });
    const result = await exitService.submit({
      symbol: String(position.symbol).toUpperCase(),
      direction: String(position.side) === "short" ? "BUY" : "SELL",
      quantity,
      openQuantity: quantity,
      reason,
      clientOrderId,
    });
    await db
      .from("paper_position_exit_claims")
      .update({
        status: "SUBMITTED",
        broker_order_id: result.brokerOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq("client_order_id", clientOrderId);
    await db
      .from("paper_positions")
      .update({ status: "EXIT_PENDING", exit_reason: reason })
      .eq("user_id", ownerId)
      .eq("broker_position_id", String(position.asset_id));
    await db.from("audit_events").insert({
      user_id: ownerId,
      action: "PAPER_POSITION_EXIT_SUBMITTED",
      metadata: {
        mode: "PAPER",
        broker: "ALPACA_PAPER",
        reason,
        symbol: position.symbol,
        client_order_id: clientOrderId,
      },
    });
  } catch (error) {
    await db
      .from("paper_position_exit_claims")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "EXIT_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("client_order_id", clientOrderId);
  }
}

async function synchronizeOwnerPortfolio(
  ownerId,
  account,
  positions,
  orders,
  fills,
  portfolioHistory,
  asOf,
) {
  const [{ data: controls }, { data: legacyPositions }] = await Promise.all([
    db
      .from("paper_positions")
      .select(
        "broker_position_id,stop_loss,take_profit,strategy_name,opened_at",
      )
      .eq("user_id", ownerId),
    db
      .from("positions")
      .select("symbol,stop_loss,take_profit,source,opened_at")
      .eq("user_id", ownerId),
  ]);
  const legacyMap = new Map(
    (legacyPositions ?? []).map((row) => [
      String(row.symbol).toUpperCase(),
      row,
    ]),
  );
  const controlMap = new Map(
    (controls ?? []).map((row) => [row.broker_position_id, row]),
  );
  const openIds = positions.map((position) => String(position.asset_id));
  for (const position of positions) {
    const id = String(position.asset_id);
    const control =
      controlMap.get(id) ??
      legacyMap.get(String(position.symbol).toUpperCase());
    await db.from("paper_positions").upsert(
      {
        user_id: ownerId,
        broker_position_id: id,
        symbol: String(position.symbol).toUpperCase(),
        side: String(position.side) === "short" ? "SHORT" : "LONG",
        quantity: Math.abs(number(position.qty)),
        entry_price: number(position.avg_entry_price),
        current_price: number(position.current_price),
        market_value: Math.abs(number(position.market_value)),
        unrealized_pl: number(position.unrealized_pl),
        unrealized_pl_pct: number(position.unrealized_plpc) * 100,
        stop_loss: control?.stop_loss ?? null,
        take_profit: control?.take_profit ?? null,
        strategy_name:
          control?.strategy_name ??
          control?.source ??
          "External / Manual PAPER",
        status: "OPEN",
        opened_at: control?.opened_at ?? asOf,
        last_synced_at: asOf,
      },
      { onConflict: "user_id,broker_position_id" },
    );
    const price = number(position.current_price);
    const isLong = String(position.side) !== "short";
    const stopTriggered =
      control?.stop_loss != null &&
      (isLong
        ? price <= number(control.stop_loss)
        : price >= number(control.stop_loss));
    const targetTriggered =
      control?.take_profit != null &&
      (isLong
        ? price >= number(control.take_profit)
        : price <= number(control.take_profit));
    if (stopTriggered)
      await submitProtectivePaperExit(ownerId, position, "STOP_LOSS");
    else if (targetTriggered)
      await submitProtectivePaperExit(ownerId, position, "TAKE_PROFIT");
  }
  for (const prior of controls ?? [])
    if (!openIds.includes(prior.broker_position_id))
      await db
        .from("paper_positions")
        .update({ status: "CLOSED", closed_at: asOf, last_synced_at: asOf })
        .eq("user_id", ownerId)
        .eq("broker_position_id", prior.broker_position_id)
        .in("status", ["OPEN", "EXIT_PENDING"]);
  const unrealized = positions.reduce(
    (sum, position) => sum + number(position.unrealized_pl),
    0,
  );
  const exposure = positions.reduce(
    (sum, position) => sum + Math.abs(number(position.market_value)),
    0,
  );
  const intradayUnrealized = positions.reduce(
    (sum, position) => sum + number(position.unrealized_intraday_pl),
    0,
  );
  const dailyEquityChange =
    number(account.equity ?? account.portfolio_value) -
    number(account.last_equity);
  const realizedToday = dailyEquityChange - intradayUnrealized;
  await db.from("paper_portfolio_current").upsert({
    user_id: ownerId,
    account_id_masked: masked(account.account_number),
    equity: number(account.equity ?? account.portfolio_value),
    cash: number(account.cash),
    buying_power: number(account.buying_power),
    realized_pl_today: realizedToday,
    unrealized_pl: unrealized,
    open_exposure: exposure,
    position_count: positions.length,
    open_order_count: orders.length,
    source: "ALPACA_PAPER",
    as_of: asOf,
    updated_at: asOf,
  });
  await db.from("paper_portfolio_pl_history").upsert(
    {
      user_id: ownerId,
      sample_key: asOf.slice(0, 16),
      equity: number(account.equity ?? account.portfolio_value),
      realized_pl: realizedToday,
      unrealized_pl: unrealized,
      open_exposure: exposure,
      sampled_at: asOf,
    },
    { onConflict: "user_id,sample_key" },
  );
  if (fills.length)
    await db.from("paper_broker_fills").upsert(
      fills.map((fill) => ({
        user_id: ownerId,
        broker_execution_id: String(fill.id ?? fill.activity_id),
        broker_order_id: String(fill.order_id ?? ""),
        symbol: String(fill.symbol).toUpperCase(),
        side: String(fill.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
        quantity: number(fill.qty),
        price: number(fill.price),
        strategy_name: "Alpaca PAPER",
        executed_at: String(fill.transaction_time ?? asOf),
        raw: fill,
      })),
      { onConflict: "user_id,broker_execution_id", ignoreDuplicates: true },
    );
}

async function processBacktestJob() {
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("backtests")
    .update({ status: "QUEUED", error: "WORKER_RESTART_RECOVERY" })
    .eq("status", "RUNNING")
    .lt("started_at", staleBefore);
  const { data: queued } = await db
    .from("backtests")
    .select("id,user_id,configuration")
    .eq("status", "QUEUED")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!queued) return;
  const { data: claimed } = await db
    .from("backtests")
    .update({
      status: "RUNNING",
      progress: 5,
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", queued.id)
    .eq("status", "QUEUED")
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  try {
    const config = queued.configuration;
    const candles = await fetchAlpacaHistoricalBars(
      config.symbol,
      config.start,
      config.end,
      config.timeframe,
    );
    await db.from("backtests").update({ progress: 45 }).eq("id", queued.id);
    const result = runHistoricalBacktest(config, candles);
    await db.from("backtest_trades").upsert(
      result.trades.map((trade, index) => ({
        backtest_id: queued.id,
        user_id: queued.user_id,
        trade_index: index,
        symbol: trade.symbol,
        strategy: trade.strategy,
        direction: trade.direction,
        entry_timestamp: trade.entryTimestamp,
        entry_price: trade.entryPrice,
        exit_timestamp: trade.exitTimestamp,
        exit_price: trade.exitPrice,
        quantity: trade.quantity,
        stop_price: trade.stop,
        target_price: trade.target,
        gross_pl: trade.grossPl,
        costs: trade.costs,
        net_pl: trade.netPl,
        return_pct: trade.returnPct,
        exit_reason: trade.exitReason,
        duration_ms: trade.durationMs,
      })),
      { onConflict: "backtest_id,trade_index" },
    );
    await db
      .from("backtests")
      .update({
        status: "COMPLETED",
        progress: 100,
        metrics: result.metrics,
        assumptions: result.assumptions,
        equity_curve: result.equityCurve,
        drawdown_curve: result.drawdownCurve,
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
  } catch (error) {
    await db
      .from("backtests")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "BACKTEST_FAILED",
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
  }
}

const researchUniverse = (
  process.env.RESEARCH_UNIVERSE ??
  "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,NFLX,SPY,QQQ"
)
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const researchWeight = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const researchWeights = {
  technical: researchWeight("RESEARCH_WEIGHT_TECHNICAL", 25),
  fundamental: researchWeight("RESEARCH_WEIGHT_FUNDAMENTAL", 20),
  catalyst: researchWeight("RESEARCH_WEIGHT_CATALYST", 20),
  marketContext: researchWeight("RESEARCH_WEIGHT_MARKET_CONTEXT", 10),
  historical: researchWeight("RESEARCH_WEIGHT_HISTORICAL", 10),
  risk: researchWeight("RESEARCH_WEIGHT_RISK", 15),
};
if (Object.values(researchWeights).every((weight) => weight === 0))
  throw new Error("RESEARCH_WEIGHTS_REQUIRED");
async function ensureScheduledResearchJob() {
  const { data: owners } = await db.from("profiles").select("id");
  const bucketMs = Math.max(
    900_000,
    Number(process.env.RESEARCH_REFRESH_INTERVAL_MS ?? 3_600_000),
  );
  const bucket = Math.floor(Date.now() / bucketMs);
  for (const owner of owners ?? []) {
    const symbol = researchUniverse[bucket % researchUniverse.length];
    await db.from("intelligence_research_jobs").upsert(
      {
        user_id: owner.id,
        symbol,
        job_key: `scheduled:${symbol}:${bucket}`,
        status: "QUEUED",
      },
      { onConflict: "user_id,job_key", ignoreDuplicates: true },
    );
  }
}

async function processResearchJob() {
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("intelligence_research_jobs")
    .update({ status: "QUEUED", error: "WORKER_RESTART_RECOVERY" })
    .eq("status", "RUNNING")
    .lt("started_at", staleBefore);
  const { data: queued } = await db
    .from("intelligence_research_jobs")
    .select("id,user_id,symbol")
    .eq("status", "QUEUED")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!queued) return;
  const { data: claimed } = await db
    .from("intelligence_research_jobs")
    .update({
      status: "RUNNING",
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", queued.id)
    .eq("status", "QUEUED")
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  try {
    const end = new Date().toISOString(),
      start = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const [bars, newsResult, actionsResult, secResult, contextBars] =
      await Promise.all([
        fetchAlpacaHistoricalBars(queued.symbol, start, end, "1Day"),
        fetchAlpacaNews(queued.symbol).catch(() => []),
        fetchCorporateActions(queued.symbol).catch(() => []),
        fetchSecBundle(queued.symbol).catch(() => null),
        Promise.all(
          ["SPY", "QQQ", "DIA", "IWM"].map((symbol) =>
            fetchAlpacaHistoricalBars(symbol, start, end, "1Day").catch(
              () => [],
            ),
          ),
        ),
      ]);
    const last = bars.at(-1),
      asset = {
        id: queued.symbol.toLowerCase(),
        symbol: queued.symbol,
        name: queued.symbol,
        assetClass: "EQUITY",
        currency: "USD",
      };
    const strategyInput = {
      asset,
      candles: bars,
      timestamp: last.time,
      quote: {
        assetId: asset.id,
        bid: last.close,
        ask: last.close,
        last: last.close,
        asOf: last.time,
        source: "ALPACA_IEX",
        isDemo: false,
        isDelayed: false,
        provider: "ALPACA",
        feed: "IEX",
      },
    };
    const signals = defaultStrategies().map((strategy) =>
      strategy.evaluate(strategyInput),
    );
    const technicalCombined = combineStrategySignals(signals);
    const contextEvidence = contextBars
      .filter((items) => items.length >= 30)
      .map((items) => {
        const latest = items.at(-1).close,
          baseline = items.at(-20).close;
        const returns = items
          .slice(-20)
          .map((bar, index, array) =>
            index
              ? (bar.close - array[index - 1].close) / array[index - 1].close
              : 0,
          );
        const volatility =
          Math.sqrt(
            returns.reduce((sum, value) => sum + value * value, 0) /
              Math.max(1, returns.length),
          ) *
          Math.sqrt(252) *
          100;
        return { trendPct: ((latest - baseline) / baseline) * 100, volatility };
      });
    const avg = (key) =>
      contextEvidence.length
        ? contextEvidence.reduce((sum, item) => sum + item[key], 0) /
          contextEvidence.length
        : 0;
    const contextTrend = avg("trendPct"),
      contextVolatility = avg("volatility");
    const marketContext = {
      score: Math.round(
        Math.max(
          0,
          Math.min(
            100,
            50 + contextTrend * 4 - Math.max(0, contextVolatility - 30),
          ),
        ),
      ),
      confidence: Math.round((contextEvidence.length / 4) * 100),
      explanation: [
        `SPY/QQQ/DIA/IWM average 20-session trend ${contextTrend.toFixed(2)}%; annualized volatility ${contextVolatility.toFixed(2)}%.`,
      ],
      regime:
        contextVolatility > 35
          ? "ELEVATED_VOLATILITY"
          : contextTrend > 2
            ? "BULLISH_TREND"
            : contextTrend < -2
              ? "BEARISH_TREND"
              : "SIDEWAYS_CHOPPY",
    };
    const metrics = secResult ? normalizeSecFacts(secResult.facts) : [],
      filings = secResult
        ? normalizeSecFilings(secResult.submissions, secResult.cik)
        : [];
    const { data: backtests } = await db
      .from("backtests")
      .select("metrics,strategy_name,configuration")
      .eq("user_id", queued.user_id)
      .eq("status", "COMPLETED")
      .contains("configuration", { symbol: queued.symbol });
    const evidenceRows = backtests ?? [],
      evidenceMetrics = evidenceRows.map((row) => row.metrics ?? {});
    const historical = evidenceRows.length
      ? {
          score: Math.round(
            Math.max(
              0,
              Math.min(
                100,
                50 +
                  evidenceMetrics.reduce(
                    (sum, item) => sum + Number(item.expectancy ?? 0),
                    0,
                  ) /
                    evidenceRows.length,
              ),
            ),
          ),
          confidence: Math.min(100, evidenceRows.length * 20),
          explanation: [
            `${evidenceRows.length} comparable historical backtests. Past performance is not predictive.`,
          ],
          evidence: {
            comparableBacktests: evidenceRows.length,
            tradeCount: evidenceMetrics.reduce(
              (sum, item) => sum + Number(item.totalTrades ?? 0),
              0,
            ),
            winRate: avgMetric(evidenceMetrics, "winRate"),
            profitFactor: avgMetric(evidenceMetrics, "profitFactor"),
            drawdown: avgMetric(evidenceMetrics, "maximumDrawdownPct"),
            expectancy: avgMetric(evidenceMetrics, "expectancy"),
            return: avgMetric(evidenceMetrics, "totalReturnPct"),
          },
        }
      : {
          score: 0,
          confidence: 0,
          explanation: ["NO HISTORICAL EVIDENCE AVAILABLE"],
          evidence: { status: "NO HISTORICAL EVIDENCE AVAILABLE" },
        };
    const { data: portfolio } = await db
      .from("paper_portfolio_current")
      .select("equity,open_exposure")
      .eq("user_id", queued.user_id)
      .maybeSingle();
    const exposurePct =
      Number(portfolio?.equity) > 0
        ? (Number(portfolio.open_exposure) / Number(portfolio.equity)) * 100
        : 0;
    const risk = {
      score: Math.round(Math.max(0, 100 - exposurePct)),
      confidence: portfolio ? 100 : 25,
      explanation: [
        `Current PAPER exposure is ${exposurePct.toFixed(2)}% of equity.`,
      ],
    };
    const snapshot = await buildIntelligenceSnapshot(
      {
        symbol: queued.symbol,
        price: last.close,
        quoteTimestamp: last.time,
        technical: {
          score: technicalCombined.score,
          confidence: signals.length ? 100 : 0,
          explanation: signals.map(
            (signal) =>
              `${signal.strategyName}: ${signal.direction} ${signal.score}/100`,
          ),
        },
        news: newsResult,
        metrics,
        filings,
        corporateActions: actionsResult,
        marketContext,
        historical,
        risk,
        weights: researchWeights,
      },
      new OpenAIResponsesResearchProvider(),
    );
    const retrievedAt = new Date().toISOString();
    if (newsResult.length)
      await db.from("market_news").upsert(
        newsResult.map((article) => ({
          user_id: queued.user_id,
          provider_id: article.id,
          headline: article.headline,
          summary: article.summary,
          source: article.source,
          author: article.author,
          published_at: article.publishedAt,
          symbols: article.symbols,
          url: article.url,
          retrieved_at: article.retrievedAt,
          analysis: analyzeNews(article),
        })),
        { onConflict: "user_id,provider_id" },
      );
    if (metrics.length)
      await db.from("company_fundamentals").upsert(
        metrics.map((metric) => ({
          user_id: queued.user_id,
          symbol: queued.symbol,
          cik: secResult?.cik ?? "",
          metric_name: metric.name,
          value: metric.value,
          unit: metric.unit,
          period_end: metric.periodEnd || null,
          filed_at: metric.filedAt || null,
          form: metric.form || null,
          provenance: metric.provenance,
          retrieved_at: retrievedAt,
        })),
        { onConflict: "user_id,symbol,metric_name,period_end,form" },
      );
    if (filings.length)
      await db.from("sec_filings").upsert(
        filings.map((filing) => ({
          user_id: queued.user_id,
          symbol: queued.symbol,
          cik: secResult.cik,
          form: filing.form,
          filing_date: filing.filingDate,
          accession: filing.accession,
          company: filing.company,
          source_url: filing.url,
          retrieved_at: retrievedAt,
        })),
        { onConflict: "user_id,accession" },
      );
    if (actionsResult.length)
      await db.from("corporate_actions").upsert(
        actionsResult.map((action) => ({
          user_id: queued.user_id,
          provider_id: action.id,
          symbol: queued.symbol,
          action_type: action.type,
          effective_date: action.date || null,
          details: action.details,
          retrieved_at: retrievedAt,
        })),
        { onConflict: "user_id,provider_id" },
      );
    const sourceReferences = [
      ...newsResult.map((item) => ({
        provider: item.source,
        id: item.id,
        timestamp: item.publishedAt,
        url: item.url,
      })),
      ...filings.map((item) => ({
        provider: "SEC_EDGAR",
        id: item.accession,
        timestamp: item.filingDate,
        url: item.url,
      })),
    ];
    await db.from("intelligence_snapshots").insert({
      user_id: queued.user_id,
      job_id: queued.id,
      symbol: queued.symbol,
      direction: technicalCombined.direction,
      current_price: last.close,
      opportunity_score: snapshot.opportunityScore,
      confidence: snapshot.confidence,
      technical_score: snapshot.breakdown.technical,
      fundamental_score: snapshot.breakdown.fundamental,
      catalyst_score: snapshot.breakdown.catalyst,
      market_context_score: snapshot.breakdown.marketContext,
      historical_score: snapshot.breakdown.historical,
      risk_score: snapshot.breakdown.risk,
      weights: snapshot.weights,
      source_facts: snapshot.sourceFacts,
      deterministic_analysis: snapshot.deterministicAnalysis,
      ai_status: snapshot.aiStatus,
      ai_analysis: snapshot.aiReport,
      freshness: snapshot.freshness,
      source_references: sourceReferences,
      generated_at: snapshot.generatedAt,
    });
    await db
      .from("intelligence_research_jobs")
      .update({ status: "COMPLETED", completed_at: retrievedAt })
      .eq("id", queued.id);
  } catch (error) {
    await db
      .from("intelligence_research_jobs")
      .update({
        status: "FAILED",
        error: error instanceof Error ? error.message : "RESEARCH_FAILED",
        completed_at: new Date().toISOString(),
      })
      .eq("id", queued.id);
  }
}
const avgMetric = (rows, key) =>
  rows.length
    ? rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length
    : 0;

async function cycle() {
  const startedAt = new Date().toISOString();
  await ensureScheduledResearchJob();
  await processResearchJob();
  await processBacktestJob();
  const { data: owners, error } = await db.from("profiles").select("id");
  if (error) throw error;
  const [account, positions, orders, fills, portfolioHistory, snapshots] =
    await Promise.all([
      json(`${PAPER_URL}/v2/account`, {
        headers: brokerHeaders(),
      }),
      json(`${PAPER_URL}/v2/positions`, {
        headers: brokerHeaders(),
      }),
      json(`${PAPER_URL}/v2/orders?status=open`, {
        headers: brokerHeaders(),
      }),
      json(
        `${PAPER_URL}/v2/account/activities/FILL?direction=desc&page_size=100`,
        { headers: brokerHeaders() },
      ),
      json(
        `${PAPER_URL}/v2/account/portfolio/history?period=1D&timeframe=1Min`,
        { headers: brokerHeaders() },
      ),
      json(
        `${DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`,
        {
          headers: headers(
            process.env.ALPACA_API_KEY,
            process.env.ALPACA_API_SECRET,
          ),
        },
      ),
    ]);
  for (const owner of owners ?? []) {
    const { data: state } = await db
      .from("system_state")
      .select("auto_trader_status,emergency_stop_active")
      .eq("user_id", owner.id)
      .maybeSingle();
    const autoTraderPermitted =
      state?.auto_trader_status === "ACTIVE" &&
      state?.emergency_stop_active === false;
    await synchronizeOwnerPortfolio(
      owner.id,
      account,
      positions,
      orders,
      fills,
      portfolioHistory,
      startedAt,
    );
    const metadata = {
      accountStatus: account?.status ?? "UNKNOWN",
      positionCount: positions?.length ?? 0,
      openOrderCount: orders?.length ?? 0,
      scannedSymbols: Object.keys(snapshots ?? {}),
      marketData: "ALPACA_IEX",
      broker: "ALPACA_PAPER",
      autoTrader: autoTraderPermitted ? "SCHEDULED" : "PAUSED",
      safety: "LIVE_LOCKED",
    };
    await db.from("trading_worker_heartbeats").upsert(
      {
        user_id: owner.id,
        worker_id: workerId,
        status: "ONLINE",
        runtime: "HOSTED_PRODUCTION",
        last_seen_at: new Date().toISOString(),
        version: process.env.WORKER_VERSION ?? "TRADE-011",
        metadata,
      },
      { onConflict: "user_id,worker_id" },
    );
    await db
      .from("trading_worker_runs")
      .insert({
        user_id: owner.id,
        worker_id: workerId,
        task_type: "HOSTED_CYCLE",
        idempotency_key: `${workerId}:${owner.id}:${startedAt.slice(0, 16)}`,
        status: "COMPLETED",
        details: metadata,
      })
      .then(() => undefined);
  }
}

async function loop() {
  try {
    await cycle();
    console.log(
      JSON.stringify({
        level: "info",
        event: "worker_cycle_complete",
        at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "worker_cycle_failed",
        message: error instanceof Error ? error.message : "UNKNOWN",
        at: new Date().toISOString(),
      }),
    );
  }
  if (!stopping) setTimeout(loop, intervalMs);
}
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await loop();
