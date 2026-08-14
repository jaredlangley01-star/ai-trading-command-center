import type { NormalizedNews, VerifiedMetric } from "./analysis.ts";

const alpacaHeaders = () => ({
  "APCA-API-KEY-ID": process.env.ALPACA_API_KEY!,
  "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET!,
});
export function normalizeAlpacaNews(
  row: Record<string, unknown>,
  retrievedAt = new Date().toISOString(),
): NormalizedNews {
  return {
    id: String(row.id),
    headline: String(row.headline ?? ""),
    summary: String(row.summary ?? ""),
    source: String(row.source ?? "Alpaca News"),
    author: row.author ? String(row.author) : null,
    publishedAt: String(row.created_at ?? row.updated_at),
    symbols: Array.isArray(row.symbols) ? row.symbols.map(String) : [],
    url: String(row.url ?? ""),
    retrievedAt,
  };
}
export async function fetchAlpacaNews(
  symbol: string,
  fetcher: typeof fetch = fetch,
) {
  const url = `${process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets"}/v1beta1/news?symbols=${encodeURIComponent(symbol)}&limit=50&sort=desc&include_content=false`;
  const response = await fetcher(url, {
    headers: alpacaHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ALPACA_NEWS_${response.status}`);
  const payload = (await response.json()) as {
    news?: Array<Record<string, unknown>>;
  };
  return (payload.news ?? []).map((row) => normalizeAlpacaNews(row));
}
export function normalizeCorporateAction(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? row.corporate_action_id),
    type: String(row.ca_type ?? row.type ?? "OTHER").toUpperCase(),
    symbol: String(row.initiating_symbol ?? row.symbol ?? ""),
    date: String(row.ex_date ?? row.process_date ?? row.date ?? ""),
    details: row,
  };
}
export async function fetchCorporateActions(
  symbol: string,
  fetcher: typeof fetch = fetch,
) {
  const url = `${process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets"}/v1beta1/corporate-actions?symbols=${encodeURIComponent(symbol)}&limit=100`;
  const response = await fetcher(url, {
    headers: alpacaHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`ALPACA_CORPORATE_ACTIONS_${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const rows = Object.values(payload).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  return rows.map((row) => normalizeCorporateAction(row));
}

const secHeaders = () => {
  if (!process.env.SEC_USER_AGENT) throw new Error("SEC_USER_AGENT_REQUIRED");
  return {
    "User-Agent": process.env.SEC_USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
  };
};
export async function fetchSecBundle(
  symbol: string,
  fetcher: typeof fetch = fetch,
) {
  const mappingResponse = await fetcher(
    "https://www.sec.gov/files/company_tickers_exchange.json",
    { headers: secHeaders() },
  );
  if (!mappingResponse.ok)
    throw new Error(`SEC_TICKER_MAP_${mappingResponse.status}`);
  const mapping = (await mappingResponse.json()) as {
    fields: string[];
    data: unknown[][];
  };
  const tickerIndex = mapping.fields.indexOf("ticker"),
    cikIndex = mapping.fields.indexOf("cik");
  const row = mapping.data.find(
    (item) => String(item[tickerIndex]).toUpperCase() === symbol.toUpperCase(),
  );
  if (!row) throw new Error("SEC_CIK_NOT_FOUND");
  const cik = String(row[cikIndex]).padStart(10, "0");
  const [factsResponse, submissionsResponse] = await Promise.all([
    fetcher(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: secHeaders(),
    }),
    fetcher(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: secHeaders(),
    }),
  ]);
  if (!factsResponse.ok || !submissionsResponse.ok)
    throw new Error("SEC_DATA_UNAVAILABLE");
  return {
    cik,
    facts: (await factsResponse.json()) as Record<string, unknown>,
    submissions: (await submissionsResponse.json()) as Record<string, unknown>,
  };
}
const concepts: Record<string, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"],
  netIncome: ["NetIncomeLoss"],
  eps: ["EarningsPerShareDiluted"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  sharesOutstanding: [
    "CommonStocksIncludingAdditionalPaidInCapitalMember",
    "EntityCommonStockSharesOutstanding",
  ],
};
export function normalizeSecFacts(
  payload: Record<string, unknown>,
): VerifiedMetric[] {
  const usGaap = ((payload.facts as Record<string, unknown>)?.["us-gaap"] ??
    {}) as Record<
    string,
    { units?: Record<string, Array<Record<string, unknown>>> }
  >;
  const result: VerifiedMetric[] = [];
  for (const [name, tags] of Object.entries(concepts))
    for (const tag of tags) {
      const units = usGaap[tag]?.units ?? {};
      const rows = Object.values(units)
        .flat()
        .filter((row) => ["10-K", "10-Q"].includes(String(row.form)))
        .sort(
          (a, b) => Date.parse(String(b.filed)) - Date.parse(String(a.filed)),
        );
      const latest = rows[0];
      if (!latest || !Number.isFinite(Number(latest.val))) continue;
      result.push({
        name,
        value: Number(latest.val),
        unit: Object.keys(units)[0] ?? "unknown",
        periodEnd: String(latest.end),
        filedAt: String(latest.filed),
        form: String(latest.form),
        provenance: "REPORTED",
      });
      if (["revenue", "netIncome"].includes(name)) {
        const prior = rows.find(
          (candidate) =>
            String(candidate.end) !== String(latest.end) &&
            String(candidate.form) === String(latest.form) &&
            Number(candidate.val) !== 0,
        );
        if (prior)
          result.push({
            name: `${name}Growth`,
            value:
              ((Number(latest.val) - Number(prior.val)) /
                Math.abs(Number(prior.val))) *
              100,
            unit: "percent",
            periodEnd: String(latest.end),
            filedAt: String(latest.filed),
            form: String(latest.form),
            provenance: "DERIVED",
          });
      }
      break;
    }
  const derived: VerifiedMetric[] = [];
  const value = (name: string) =>
    result.find((item) => item.name === name)?.value;
  if (value("revenue") && value("netIncome") != null)
    derived.push({
      name: "profitMargin",
      value: (value("netIncome")! / value("revenue")!) * 100,
      unit: "percent",
      periodEnd: result[0]?.periodEnd ?? "",
      filedAt: result[0]?.filedAt ?? "",
      form: result[0]?.form ?? "",
      provenance: "DERIVED",
    });
  if (value("assets") && value("liabilities") != null)
    derived.push({
      name: "liabilitiesToAssets",
      value: value("liabilities")! / value("assets")!,
      unit: "ratio",
      periodEnd: result[0]?.periodEnd ?? "",
      filedAt: result[0]?.filedAt ?? "",
      form: result[0]?.form ?? "",
      provenance: "DERIVED",
    });
  return [...result, ...derived];
}
export function normalizeSecFilings(
  payload: Record<string, unknown>,
  cik: string,
) {
  const recent = ((payload.filings as Record<string, unknown>)?.recent ??
    {}) as Record<string, unknown[]>;
  return (recent.form ?? [])
    .map((form, index) => ({
      form: String(form),
      filingDate: String(recent.filingDate?.[index]),
      accession: String(recent.accessionNumber?.[index]),
      company: String(payload.name ?? ""),
      cik,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(recent.accessionNumber?.[index]).replaceAll("-", "")}/${String(recent.primaryDocument?.[index])}`,
    }))
    .filter((item) => ["10-K", "10-Q", "8-K"].includes(item.form))
    .slice(0, 20);
}
