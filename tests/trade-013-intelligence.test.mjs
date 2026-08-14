import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeNews,
  catalystScore,
  compositeOpportunity,
  freshness,
  fundamentalScore,
} from "../src/services/intelligence/analysis.ts";
import { buildIntelligenceSnapshot } from "../src/services/intelligence/engine.ts";
import { OpenAIResponsesResearchProvider } from "../src/services/intelligence/ai-provider.ts";
import {
  normalizeAlpacaNews,
  normalizeCorporateAction,
  normalizeSecFacts,
  normalizeSecFilings,
} from "../src/services/intelligence/sources.ts";

test("Alpaca news normalization preserves provenance without fabrication", () => {
  const item = normalizeAlpacaNews(
    {
      id: 42,
      headline: "Company reports earnings",
      summary: "Revenue grew.",
      source: "Reuters",
      author: "A. Reporter",
      created_at: "2026-01-01T12:00:00Z",
      symbols: ["AAPL"],
      url: "https://example.com/article",
    },
    "2026-01-01T12:01:00Z",
  );
  assert.deepEqual(item, {
    id: "42",
    headline: "Company reports earnings",
    summary: "Revenue grew.",
    source: "Reuters",
    author: "A. Reporter",
    publishedAt: "2026-01-01T12:00:00Z",
    symbols: ["AAPL"],
    url: "https://example.com/article",
    retrievedAt: "2026-01-01T12:01:00Z",
  });
  assert.equal(analyzeNews(item).category, "EARNINGS");
});

test("SEC facts distinguish REPORTED and DERIVED metrics and tolerate missing data", () => {
  const facts = {
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              {
                val: 120,
                end: "2025-12-31",
                filed: "2026-02-01",
                form: "10-K",
              },
              {
                val: 100,
                end: "2024-12-31",
                filed: "2025-02-01",
                form: "10-K",
              },
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              { val: 24, end: "2025-12-31", filed: "2026-02-01", form: "10-K" },
            ],
          },
        },
        Assets: {
          units: {
            USD: [
              {
                val: 200,
                end: "2025-12-31",
                filed: "2026-02-01",
                form: "10-K",
              },
            ],
          },
        },
        Liabilities: {
          units: {
            USD: [
              { val: 80, end: "2025-12-31", filed: "2026-02-01", form: "10-K" },
            ],
          },
        },
      },
    },
  };
  const metrics = normalizeSecFacts(facts);
  assert.equal(
    metrics.find((item) => item.name === "revenue")?.provenance,
    "REPORTED",
  );
  assert.equal(
    metrics.find((item) => item.name === "revenueGrowth")?.value,
    20,
  );
  assert.equal(
    metrics.find((item) => item.name === "profitMargin")?.provenance,
    "DERIVED",
  );
  assert.equal(fundamentalScore([]).confidence, 0);
  assert.ok(fundamentalScore(metrics).confidence > 0);
});

test("SEC filings and corporate actions retain source identity", () => {
  const filings = normalizeSecFilings(
    {
      name: "Example Inc",
      filings: {
        recent: {
          form: ["10-Q", "S-8"],
          filingDate: ["2026-05-01", "2026-04-01"],
          accessionNumber: ["0001-26-000001", "0002"],
          primaryDocument: ["q.htm", "s8.htm"],
        },
      },
    },
    "0000000001",
  );
  assert.equal(filings.length, 1);
  assert.match(filings[0].url, /sec\.gov\/Archives/);
  const action = normalizeCorporateAction({
    corporate_action_id: "ca1",
    ca_type: "forward_split",
    initiating_symbol: "AAPL",
    ex_date: "2026-06-01",
  });
  assert.equal(action.type, "FORWARD_SPLIT");
  assert.equal(action.id, "ca1");
});

test("catalyst scoring deliberately records contradictory evidence", () => {
  const base = {
    summary: "",
    source: "source",
    author: null,
    symbols: ["AAPL"],
    url: "https://example.com",
    retrievedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    significance: 80,
    shortTermRelevance: 90,
    mediumTermRelevance: 60,
    category: "EARNINGS",
  };
  const result = catalystScore(
    [
      {
        ...base,
        id: "1",
        headline: "beat",
        sentiment: "POSITIVE",
        sentimentScore: 80,
      },
      {
        ...base,
        id: "2",
        headline: "miss",
        sentiment: "NEGATIVE",
        sentimentScore: -80,
      },
    ],
    [],
    [],
  );
  assert.match(result.explanation.join(" "), /conflict/i);
});

test("composite score is deterministic and confidence measures completeness", () => {
  const part = (score, confidence) => ({ score, confidence, explanation: [] });
  const result = compositeOpportunity({
    technical: part(80, 100),
    fundamental: part(60, 50),
    catalyst: part(70, 75),
    marketContext: part(50, 100),
    historical: part(0, 0),
    risk: part(90, 100),
  });
  assert.equal(result.score, 65);
  assert.ok(result.confidence < 100);
  assert.deepEqual(result.weights, {
    technical: 25,
    fundamental: 20,
    catalyst: 20,
    marketContext: 10,
    historical: 10,
    risk: 15,
  });
});

test("research freshness marks stale and unavailable components", () => {
  assert.equal(freshness(null, 1000).status, "UNAVAILABLE");
  assert.equal(
    freshness(new Date(Date.now() - 5000).toISOString(), 1000).status,
    "STALE",
  );
});

test("AI unavailable fallback preserves deterministic research", async () => {
  const priorKey = process.env.AI_API_KEY,
    priorModel = process.env.AI_MODEL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  const provider = new OpenAIResponsesResearchProvider();
  assert.equal(await provider.synthesize({ verified: true }), null);
  const zero = { score: 0, confidence: 0, explanation: ["unavailable"] };
  const snapshot = await buildIntelligenceSnapshot(
    {
      symbol: "AAPL",
      price: 100,
      quoteTimestamp: new Date().toISOString(),
      technical: { score: 80, confidence: 100, explanation: [] },
      news: [],
      metrics: [],
      filings: [],
      corporateActions: [],
      marketContext: zero,
      historical: zero,
      risk: { score: 80, confidence: 100, explanation: [] },
    },
    provider,
  );
  assert.equal(snapshot.aiStatus, "AI ANALYSIS UNAVAILABLE");
  assert.ok(Number.isFinite(snapshot.opportunityScore));
  if (priorKey === undefined) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = priorKey;
  if (priorModel === undefined) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = priorModel;
});

test("AI and deterministic intelligence cannot invoke a broker", async () => {
  const files = await Promise.all(
    ["analysis.ts", "engine.ts", "ai-provider.ts", "sources.ts"].map((name) =>
      readFile(
        new URL(`../src/services/intelligence/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.doesNotMatch(
    files.join("\n"),
    /BrokerService|submitPaperOrder|\/v2\/orders|TradePermissionService/,
  );
});

test("persistence deduplicates sources and is owner scoped", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608140007_trade_013_intelligence.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /unique\(user_id, provider_id\)/i);
  assert.match(migration, /unique\(user_id,accession\)/i);
  for (const policy of [
    "market news",
    "fundamentals",
    "SEC filings",
    "corporate actions",
    "market context",
    "research jobs",
    "intelligence",
  ])
    assert.match(migration, new RegExp(`Owners .*${policy}`, "i"));
});

test("Railway research is configurable, incremental, restart safe, and local-free", async () => {
  const worker = await readFile(
    new URL("../hosted-worker/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(worker, /RESEARCH_UNIVERSE/);
  assert.match(worker, /RESEARCH_REFRESH_INTERVAL_MS/);
  assert.match(worker, /processResearchJob/);
  assert.match(worker, /WORKER_RESTART_RECOVERY/);
  const researchBlock =
    worker.match(
      /async function processResearchJob[\s\S]*?const avgMetric/,
    )?.[0] ?? "";
  assert.doesNotMatch(
    researchBlock,
    /localhost|127\.0\.0\.1|IBKR|TWS|submitPaperOrder|PAPER_URL/i,
  );
});
