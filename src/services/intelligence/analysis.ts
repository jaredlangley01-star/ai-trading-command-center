export type NormalizedNews = {
  id: string;
  headline: string;
  summary: string;
  source: string;
  author: string | null;
  publishedAt: string;
  symbols: string[];
  url: string;
  retrievedAt: string;
};
export type VerifiedMetric = {
  name: string;
  value: number;
  unit: string;
  periodEnd: string;
  filedAt: string;
  form: string;
  provenance: "REPORTED" | "DERIVED";
};
export type ScorePart = {
  score: number;
  confidence: number;
  explanation: string[];
};

const positive =
  /beat|growth|raise|upgrade|record|profit|approval|launch|win|strong/i;
const negative =
  /miss|decline|cut|downgrade|loss|lawsuit|investigation|recall|weak|bankrupt/i;
export function analyzeNews(article: NormalizedNews) {
  const text = `${article.headline} ${article.summary}`;
  const pos = (text.match(new RegExp(positive.source, "gi")) ?? []).length;
  const neg = (text.match(new RegExp(negative.source, "gi")) ?? []).length;
  const sentimentScore = Math.max(-100, Math.min(100, (pos - neg) * 25));
  const category = /earnings|quarter|revenue|eps/i.test(text)
    ? "EARNINGS"
    : /guidance|forecast|outlook/i.test(text)
      ? "GUIDANCE"
      : /upgrade|downgrade|analyst|price target/i.test(text)
        ? "ANALYST_ACTION"
        : /merger|acquisition|acquire/i.test(text)
          ? "MERGER_ACQUISITION"
          : /lawsuit|regulat|investigation|legal/i.test(text)
            ? "LEGAL_REGULATORY"
            : /dividend|split|spin.?off/i.test(text)
              ? "CORPORATE_ACTION"
              : "GENERAL_COMPANY_NEWS";
  const ageHours = Math.max(
    0,
    (Date.now() - Date.parse(article.publishedAt)) / 3_600_000,
  );
  return {
    sentiment:
      sentimentScore > 15
        ? "POSITIVE"
        : sentimentScore < -15
          ? "NEGATIVE"
          : "NEUTRAL",
    sentimentScore,
    significance: [
      "EARNINGS",
      "GUIDANCE",
      "MERGER_ACQUISITION",
      "LEGAL_REGULATORY",
    ].includes(category)
      ? 80
      : 50,
    shortTermRelevance: Math.max(0, Math.round(100 - ageHours * 2)),
    mediumTermRelevance: category === "GENERAL_COMPANY_NEWS" ? 35 : 65,
    category,
  };
}

export function fundamentalScore(metrics: VerifiedMetric[]): ScorePart {
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  const explanations: string[] = [];
  let points = 0,
    available = 0;
  const factor = (
    name: string,
    test: (value: number) => number,
    label: string,
  ) => {
    const value = byName.get(name);
    if (value == null) return;
    available++;
    const contribution = test(value);
    points += contribution;
    explanations.push(
      `${label}: ${value.toFixed(2)} contributed ${contribution.toFixed(0)}/100.`,
    );
  };
  factor(
    "revenueGrowth",
    (v) => 50 + Math.max(-50, Math.min(50, v * 2)),
    "Revenue growth",
  );
  factor(
    "netIncomeGrowth",
    (v) => 50 + Math.max(-50, Math.min(50, v * 2)),
    "Earnings growth",
  );
  factor(
    "profitMargin",
    (v) => Math.max(0, Math.min(100, v * 4)),
    "Profitability",
  );
  factor("operatingCashFlow", (v) => (v > 0 ? 75 : 20), "Cash generation");
  factor(
    "liabilitiesToAssets",
    (v) => Math.max(0, Math.min(100, 100 - v * 100)),
    "Balance-sheet strength",
  );
  return {
    score: available ? Math.round(points / available) : 0,
    confidence: Math.round((available / 5) * 100),
    explanation: available
      ? explanations
      : ["No verified fundamental inputs were available."],
  };
}

export function catalystScore(
  news: Array<NormalizedNews & ReturnType<typeof analyzeNews>>,
  corporateActions: Array<{ type: string; date: string }>,
  filings: Array<{ form: string; filingDate: string }>,
): ScorePart {
  const fresh = news.filter(
    (item) => Date.now() - Date.parse(item.publishedAt) < 7 * 86_400_000,
  );
  const weighted = fresh.reduce(
    (sum, item) => sum + item.sentimentScore * (item.significance / 100),
    0,
  );
  const conflict =
    fresh.some((item) => item.sentimentScore > 15) &&
    fresh.some((item) => item.sentimentScore < -15);
  const eventBoost = Math.min(
    25,
    corporateActions.length * 8 +
      filings.filter((item) => ["8-K", "10-Q", "10-K"].includes(item.form))
        .length *
        4,
  );
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        50 +
          weighted / Math.max(1, fresh.length) / 2 +
          eventBoost -
          (conflict ? 10 : 0),
      ),
    ),
  );
  return {
    score,
    confidence: Math.min(
      100,
      fresh.length * 15 + corporateActions.length * 10 + filings.length * 5,
    ),
    explanation: [
      `${fresh.length} recent verified articles; ${corporateActions.length} corporate actions; ${filings.length} relevant filings.`,
      conflict
        ? "Positive and negative evidence conflict."
        : "No material article-direction conflict detected.",
    ],
  };
}

export function compositeOpportunity(
  parts: Record<
    | "technical"
    | "fundamental"
    | "catalyst"
    | "marketContext"
    | "historical"
    | "risk",
    ScorePart
  >,
  weights = {
    technical: 25,
    fundamental: 20,
    catalyst: 20,
    marketContext: 10,
    historical: 10,
    risk: 15,
  },
) {
  const totalWeight = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0,
  );
  const score = Math.round(
    Object.entries(weights).reduce(
      (sum, [key, weight]) =>
        sum + parts[key as keyof typeof parts].score * weight,
      0,
    ) / totalWeight,
  );
  const confidence = Math.round(
    Object.entries(weights).reduce(
      (sum, [key, weight]) =>
        sum + parts[key as keyof typeof parts].confidence * weight,
      0,
    ) / totalWeight,
  );
  return {
    score,
    confidence,
    weights,
    breakdown: Object.fromEntries(
      Object.entries(parts).map(([key, value]) => [key, value.score]),
    ),
  };
}

export function freshness(timestamp: string | null, maxAgeMs: number) {
  if (!timestamp)
    return { status: "UNAVAILABLE", ageMs: null, confidenceMultiplier: 0 };
  const ageMs = Math.max(0, Date.now() - Date.parse(timestamp));
  return {
    status: ageMs <= maxAgeMs ? "CURRENT" : "STALE",
    ageMs,
    confidenceMultiplier: ageMs <= maxAgeMs ? 1 : 0.5,
  };
}
