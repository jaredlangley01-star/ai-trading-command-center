import {
  analyzeNews,
  catalystScore,
  compositeOpportunity,
  fundamentalScore,
  freshness,
  type NormalizedNews,
  type ScorePart,
  type VerifiedMetric,
} from "./analysis.ts";
import type { AIResearchProvider } from "./ai-provider.ts";

export type IntelligenceInput = {
  symbol: string;
  price: number;
  quoteTimestamp: string;
  technical: ScorePart;
  news: NormalizedNews[];
  metrics: VerifiedMetric[];
  filings: Array<{
    form: string;
    filingDate: string;
    accession: string;
    url: string;
  }>;
  corporateActions: Array<{ type: string; date: string; id?: string }>;
  marketContext: ScorePart & { regime?: string };
  historical: ScorePart & { evidence?: Record<string, unknown> };
  risk: ScorePart;
  weights?: Partial<
    Record<
      | "technical"
      | "fundamental"
      | "catalyst"
      | "marketContext"
      | "historical"
      | "risk",
      number
    >
  >;
};
export async function buildIntelligenceSnapshot(
  input: IntelligenceInput,
  ai: AIResearchProvider,
) {
  const news = input.news.map((article) => ({
    ...article,
    ...analyzeNews(article),
  }));
  const fundamental = fundamentalScore(input.metrics);
  const catalyst = catalystScore(news, input.corporateActions, input.filings);
  const parts = {
    technical: input.technical,
    fundamental,
    catalyst,
    marketContext: input.marketContext,
    historical: input.historical,
    risk: input.risk,
  };
  const composite = compositeOpportunity(parts, {
    technical: 25,
    fundamental: 20,
    catalyst: 20,
    marketContext: 10,
    historical: 10,
    risk: 15,
    ...input.weights,
  });
  const timestamps = {
    marketPrice: input.quoteTimestamp,
    technical: input.quoteTimestamp,
    news: news[0]?.publishedAt ?? null,
    fundamentals: input.metrics[0]?.filedAt ?? null,
    secFilings: input.filings[0]?.filingDate ?? null,
    corporateActions: input.corporateActions[0]?.date ?? null,
  };
  const freshnessMap = {
    marketPrice: freshness(timestamps.marketPrice, 5 * 60_000),
    technical: freshness(timestamps.technical, 30 * 60_000),
    news: freshness(timestamps.news, 7 * 86_400_000),
    fundamentals: freshness(timestamps.fundamentals, 120 * 86_400_000),
    secFilings: freshness(timestamps.secFilings, 120 * 86_400_000),
    corporateActions: freshness(timestamps.corporateActions, 365 * 86_400_000),
    marketContext: freshness(input.quoteTimestamp, 30 * 60_000),
  };
  const freshnessConfidence =
    Object.values(freshnessMap).reduce(
      (sum, item) => sum + item.confidenceMultiplier,
      0,
    ) / Object.values(freshnessMap).length;
  const confidence = Math.round(composite.confidence * freshnessConfidence);
  const verifiedResearch = {
    symbol: input.symbol,
    price: input.price,
    sourceFacts: {
      news,
      metrics: input.metrics,
      filings: input.filings,
      corporateActions: input.corporateActions,
    },
    deterministicAnalysis: {
      parts,
      composite: { ...composite, confidence },
      marketContext: input.marketContext,
      historicalEvidence:
        input.historical.evidence ?? "NO HISTORICAL EVIDENCE AVAILABLE",
      freshness: freshnessMap,
    },
  };
  const aiReport = await ai.synthesize(verifiedResearch).catch(() => null);
  const completeFreshness = {
    ...freshnessMap,
    aiAnalysis: freshness(aiReport?.generatedAt ?? null, 24 * 60 * 60_000),
  };
  return {
    ...verifiedResearch,
    opportunityScore: composite.score,
    confidence,
    breakdown: composite.breakdown,
    weights: composite.weights,
    freshness: completeFreshness,
    aiStatus: aiReport ? "AVAILABLE" : "AI ANALYSIS UNAVAILABLE",
    aiReport,
    generatedAt: new Date().toISOString(),
  };
}
