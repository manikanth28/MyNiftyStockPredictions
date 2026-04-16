import type {
  FundamentalSnapshot,
  NewsHeadline,
  ResearchSourceStatus,
  SentimentSnapshot,
  StockAnalysis,
  StockResearchStatus,
  StockSearchSuggestion
} from "@/lib/types";

export type CompanyLookup = {
  symbol: string;
  yahooSymbol: string;
  companyName: string;
  sector: string;
  industry?: string;
};

export type CompanyResearch = {
  companyName: string;
  sector: string;
  industry?: string;
  fundamentals: FundamentalSnapshot | null;
  sentiment: SentimentSnapshot | null;
  researchStatus: StockResearchStatus;
};

export type FundamentalSectorContext = {
  sector: string;
  peerCount: number;
  medianPriceToEarnings: number | null;
  medianPriceToBook: number | null;
  medianReturnOnEquityPct: number | null;
  medianReturnOnCapitalEmployedPct: number | null;
  medianDebtToEquity: number | null;
  medianSalesGrowth5YPct: number | null;
  medianEarningsGrowthPct: number | null;
};

type YahooSearchQuote = {
  exchange?: string;
  quoteType?: string;
  symbol?: string;
  longname?: string;
  shortname?: string;
  sectorDisp?: string;
  sector?: string;
  industryDisp?: string;
  industry?: string;
};

type YahooSearchResponse = {
  quotes?: YahooSearchQuote[];
};

type CachedResearch = Pick<StockAnalysis, "fundamentals" | "sentiment" | "researchStatus"> | null;
type NseAnnouncementItem = Record<string, unknown>;
type NseAnnouncementResponse = NseAnnouncementItem[] | { data?: NseAnnouncementItem[] };
type NseQuoteEquityResponse = {
  info?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  industryInfo?: Record<string, unknown>;
  securityInfo?: Record<string, unknown>;
};
type NseTradeInfoResponse = {
  marketDeptOrderBook?: {
    tradeInfo?: Record<string, unknown>;
  };
};
type YahooQuoteSummaryModule = Record<string, unknown>;
type YahooQuoteSummaryResult = {
  summaryDetail?: YahooQuoteSummaryModule;
  financialData?: YahooQuoteSummaryModule;
  defaultKeyStatistics?: YahooQuoteSummaryModule;
};
type YahooQuoteSummaryResponse = {
  quoteSummary?: {
    result?: YahooQuoteSummaryResult[];
  };
};

const POSITIVE_WORDS = [
  "beat",
  "beats",
  "bullish",
  "buy",
  "gains",
  "gain",
  "growth",
  "improves",
  "improve",
  "outperform",
  "positive",
  "rally",
  "rebound",
  "record",
  "robust",
  "strong",
  "surge",
  "safe bet",
  "upgrade",
  "upgrades",
  "accumulate"
];

const NEGATIVE_WORDS = [
  "bearish",
  "concern",
  "crash",
  "cut",
  "cuts",
  "decline",
  "declines",
  "downgrade",
  "downgrades",
  "drop",
  "drops",
  "fall",
  "falls",
  "lower",
  "miss",
  "misses",
  "pressure",
  "sell",
  "slump",
  "slumps",
  "underperform",
  "warning",
  "weak"
];

const EARNINGS_KEYWORDS = [
  "earnings",
  "results",
  "quarter",
  "q1",
  "q2",
  "q3",
  "q4",
  "revenue",
  "profit",
  "margin"
];

const ANALYST_KEYWORDS = [
  "analyst",
  "brokerage",
  "buy",
  "hold",
  "sell",
  "target",
  "rating",
  "upgrade",
  "downgrade",
  "overweight",
  "underweight",
  "outperform",
  "underperform"
];

const ANNOUNCEMENT_KEYWORDS = [
  "board meeting",
  "clarification",
  "allotment",
  "dividend",
  "bonus",
  "merger",
  "acquisition",
  "order",
  "contract",
  "credit rating",
  "trading window",
  "allotment",
  "issue",
  "update"
];

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RESEARCH_REQUEST_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.RESEARCH_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 4500;
})();
const RESEARCH_PREFLIGHT_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.RESEARCH_PREFLIGHT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 500 ? parsed : 2500;
})();
const NSE_COOKIE_TTL_MS = 10 * 60 * 1000;
const SCREENER_COOKIE_TTL_MS = 10 * 60 * 1000;
const NSE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-IN,en;q=0.9",
  Origin: "https://www.nseindia.com",
  Referer: "https://www.nseindia.com/",
  "User-Agent": "Mozilla/5.0",
  "X-Requested-With": "XMLHttpRequest"
};
let nseCookieHeader = "";
let nseCookieFetchedAt = 0;
let nseCookieRefreshPromise: Promise<string> | null = null;
let screenerCookieHeader = "";
let screenerCookieFetchedAt = 0;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeSearchSymbol(query: string) {
  return query.trim().toUpperCase().replace(/\.NS$/i, "");
}

function parseMetricNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const normalized = trimmed
    .replace(/[₹,]/g, "")
    .replace(/\bRs\.?\b/gi, "")
    .replace(/\b(Cr|Crore|%|x)\b/gi, "")
    .replace(/[()]/g, "")
    .trim();
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return negative ? -parsed : parsed;
}

function parseIndianNumber(value: string | null) {
  return parseMetricNumber(value);
}

function parsePercent(value: string | null) {
  return parseMetricNumber(value);
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordNumber(record: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = parseMetricNumber(value);

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function recordString(record: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = RESEARCH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function textContent(regex: RegExp, text: string) {
  const match = regex.exec(text);
  return match?.[1] ?? null;
}

function htmlToPlainText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstPatternMatch(texts: string[], patterns: RegExp[]) {
  for (const text of texts) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);

      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }

  return null;
}

function numberFromPatterns(texts: string[], patterns: RegExp[]) {
  return parseMetricNumber(firstPatternMatch(texts, patterns));
}

function yahooFieldValue(module: YahooQuoteSummaryModule | undefined, key: string) {
  const value = module?.[key];

  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (!hasRecord(value)) {
    return null;
  }

  const raw = value.raw;

  if (typeof raw === "number" || typeof raw === "string") {
    return raw;
  }

  const longFmt = value.longFmt;

  if (typeof longFmt === "string") {
    return longFmt;
  }

  const fmt = value.fmt;

  return typeof fmt === "string" ? fmt : null;
}

function yahooNumberField(module: YahooQuoteSummaryModule | undefined, key: string) {
  const value = yahooFieldValue(module, key);
  return typeof value === "number" ? value : parseMetricNumber(value);
}

function yahooPercentField(module: YahooQuoteSummaryModule | undefined, key: string) {
  const value = yahooNumberField(module, key);

  if (value === null) {
    return null;
  }

  const percent = Math.abs(value) <= 1.5 ? value * 100 : value;
  return Number(percent.toFixed(2));
}

function toCrore(value: number | null) {
  if (value === null) {
    return null;
  }

  return Number((value / 10_000_000).toFixed(2));
}

function normalizeDebtToEquity(value: number | null) {
  if (value === null) {
    return null;
  }

  return Number((value > 8 ? value / 100 : value).toFixed(2));
}

function hasMeaningfulFundamentalData(snapshot: FundamentalSnapshot) {
  const numericFields = [
    snapshot.marketCapCrore,
    snapshot.revenueCrore,
    snapshot.profitCrore,
    snapshot.netMarginPct,
    snapshot.priceToEarnings,
    snapshot.priceToBook,
    snapshot.salesGrowth5YPct,
    snapshot.earningsGrowthPct,
    snapshot.returnOnEquityPct,
    snapshot.returnOnCapitalEmployedPct,
    snapshot.debtToEquity,
    snapshot.operatingCashFlowCrore,
    snapshot.freeCashFlowCrore,
    snapshot.promoterHoldingPct
  ];

  return numericFields.filter((value) => value !== null && Number.isFinite(value)).length >= 2;
}

function formatSummaryMetric(value: number | null, suffix: string, maximumFractionDigits = 1) {
  if (value === null) {
    return null;
  }

  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits
  }).format(value)}${suffix}`;
}

function yahooReturnOnEquityLabel(value: number | null) {
  if (value === null) {
    return null;
  }

  if (value >= 20) {
    return "high";
  }

  if (value >= 14) {
    return "good";
  }

  if (value <= 8) {
    return "low";
  }

  return null;
}

function mergeSummary(primarySummary: string, enrichmentSummary: string) {
  const parts = [...primarySummary.split("·"), ...enrichmentSummary.split("·")]
    .map((part) => part.trim())
    .filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const key = part.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(part);
  }

  return deduped.join(" · ");
}

function backfillFundamentalSnapshotFromSummary(snapshot: FundamentalSnapshot) {
  const texts = [snapshot.summary].filter(Boolean);
  const marketCapCrore =
    snapshot.marketCapCrore ??
    numberFromPatterns(texts, [
      /Mkt Cap:\s*([\d,]+)\s*Crore/i,
      /Market Cap(?:italization)?\s*[:\-]?\s*([\d,]+)\s*(?:Cr|Crore)/i
    ]);
  const marketCapChange1YPct =
    snapshot.marketCapChange1YPct ??
    parsePercent(textContent(/Mkt Cap:[^(]+\((?:up|down)\s*(-?[\d.]+)% in 1 year\)/i, snapshot.summary));
  const revenueCrore =
    snapshot.revenueCrore ??
    numberFromPatterns(texts, [
      /Revenue:\s*([\d,]+)\s*Cr/i,
      /Revenue\s*[:\-]?\s*([\d,]+)\s*(?:Cr|Crore)/i,
      /Sales\s*[:\-]?\s*([\d,]+)\s*(?:Cr|Crore)/i
    ]);
  const profitCrore =
    snapshot.profitCrore ??
    numberFromPatterns(texts, [
      /Profit:\s*([\d,]+)\s*Cr/i,
      /Net Profit\s*[:\-]?\s*([\d,().-]+)\s*(?:Cr|Crore)/i,
      /Profit after tax\s*[:\-]?\s*([\d,().-]+)\s*(?:Cr|Crore)/i
    ]);
  const priceToEarnings =
    snapshot.priceToEarnings ??
    numberFromPatterns(texts, [
      /P\/E:\s*([\d.()-]+)x/i,
      /(?:Stock\s+)?P\/E\s*[:\-]?\s*([\d.()-]+)/i,
      /Price to earnings(?: ratio)?\s*[:\-]?\s*([\d.()-]+)/i
    ]);
  const priceToBook =
    snapshot.priceToBook ??
    numberFromPatterns(texts, [
      /P\/B:\s*([\d.()-]+)x/i,
      /(?:P\/B|Price to book(?: value)?)\s*[:\-]?\s*([\d.()-]+)/i,
      /Book value multiple\s*[:\-]?\s*([\d.()-]+)/i,
      /stock is trading at\s*([\d.()-]+)\s*times its book value/i,
      /trading at\s*([\d.()-]+)\s*times its book value/i
    ]);
  const salesGrowthLabel =
    snapshot.salesGrowthLabel ?? textContent(/company has delivered a ([a-z]+) sales growth/i, snapshot.summary);
  const salesGrowth5YPct =
    snapshot.salesGrowth5YPct ??
    numberFromPatterns(texts, [
      /sales growth of ([\d.]+)% over (?:past|last) five years/i,
      /Sales CAGR(?: 5Years| 5Y)?\s*[:\-]?\s*([\d.]+)%/i,
      /(?:3|5)\s*Years?\s*Sales\s*(?:CAGR|growth)\s*[:\-]?\s*([\d.]+)%/i,
      /Sales growth(?:[^%]{0,60})?([\d.]+)%/i
    ]);
  const earningsGrowthPct =
    snapshot.earningsGrowthPct ??
    numberFromPatterns(texts, [
      /profit growth of ([\d.]+)% over past (?:three|five|\d+) years/i,
      /earnings growth of ([\d.]+)% over past (?:three|five|\d+) years/i,
      /(?:Profit|Earnings) CAGR(?: 3Years| 5Years| 3Y| 5Y)?\s*[:\-]?\s*([\d.]+)%/i,
      /(?:3|5)\s*Years?\s*(?:Profit|Earnings)\s*(?:CAGR|growth)\s*[:\-]?\s*([\d.]+)%/i,
      /(?:earnings|profit) growth(?:[^%]{0,60})?([\d.]+)%/i
    ]);
  const returnOnEquityPct =
    snapshot.returnOnEquityPct ??
    numberFromPatterns(texts, [
      /return on equity of ([\d.]+)%/i,
      /return on equity.*?([\d.]+)%/i,
      /(?:3|5)\s*Years?\s*ROE\s*[:\-]?\s*([\d.]+)%/i,
      /ROE\s*[:\-]?\s*([\d.]+)%/i
    ]);
  const returnOnCapitalEmployedPct =
    snapshot.returnOnCapitalEmployedPct ??
    numberFromPatterns(texts, [
      /return on capital employed of ([\d.]+)%/i,
      /return on capital employed.*?([\d.]+)%/i,
      /(?:3|5)\s*Years?\s*ROCE\s*[:\-]?\s*([\d.]+)%/i,
      /ROCE\s*[:\-]?\s*([\d.]+)%/i
    ]);
  const debtToEquity =
    snapshot.debtToEquity ??
    numberFromPatterns(texts, [
      /debt(?:\/|\s*to\s*)equity(?: ratio)?\s*(?:is|of)?\s*[:\-]?\s*([\d.()-]+)/i,
      /Debt\/Equity\s*[:\-]?\s*([\d.()-]+)/i
    ]);
  const operatingCashFlowCrore =
    snapshot.operatingCashFlowCrore ??
    numberFromPatterns(texts, [
      /(?:cash from operations|operating cash flow|operating cashflow)(?: last year)?\s*(?:is|of)?\s*[:\-]?\s*(?:rs\.?\s*)?([\d,().-]+)\s*(?:Cr|Crore)/i
    ]);
  const freeCashFlowCrore =
    snapshot.freeCashFlowCrore ??
    numberFromPatterns(texts, [
      /(?:free cash flow|free cashflow|FCF)(?: last year)?\s*(?:is|of)?\s*[:\-]?\s*(?:rs\.?\s*)?([\d,().-]+)\s*(?:Cr|Crore)/i
    ]);
  const promoterHoldingPct =
    snapshot.promoterHoldingPct ??
    parsePercent(
      firstPatternMatch(texts, [
        /Promoter Holding:\s*([\d.]+)%/i,
        /Promoter holding\s*[:\-]?\s*([\d.]+)%/i
      ])
    );
  const returnOnEquityLabel =
    snapshot.returnOnEquityLabel ??
    textContent(/company has a ([a-z]+) return on equity/i, snapshot.summary) ??
    yahooReturnOnEquityLabel(returnOnEquityPct);
  const netMarginPct =
    snapshot.netMarginPct ??
    (revenueCrore !== null && profitCrore !== null && revenueCrore !== 0
      ? Number(((profitCrore / revenueCrore) * 100).toFixed(2))
      : null);

  return {
    ...snapshot,
    marketCapCrore,
    marketCapChange1YPct,
    revenueCrore,
    profitCrore,
    netMarginPct,
    priceToEarnings,
    priceToBook,
    salesGrowth5YPct,
    salesGrowthLabel,
    earningsGrowthPct,
    returnOnEquityPct,
    returnOnEquityLabel,
    returnOnCapitalEmployedPct,
    debtToEquity,
    operatingCashFlowCrore,
    freeCashFlowCrore,
    promoterHoldingPct
  } satisfies FundamentalSnapshot;
}

function mergeFundamentalSnapshots(
  primary: FundamentalSnapshot,
  enrichment: FundamentalSnapshot | null,
  source: string
) {
  if (!enrichment) {
    return backfillFundamentalSnapshotFromSummary({
      ...primary,
      source
    } satisfies FundamentalSnapshot);
  }

  return backfillFundamentalSnapshotFromSummary({
    source,
    summary: mergeSummary(primary.summary, enrichment.summary),
    marketCapCrore: enrichment.marketCapCrore ?? primary.marketCapCrore,
    marketCapChange1YPct: enrichment.marketCapChange1YPct ?? primary.marketCapChange1YPct,
    revenueCrore: enrichment.revenueCrore ?? primary.revenueCrore,
    profitCrore: enrichment.profitCrore ?? primary.profitCrore,
    netMarginPct: enrichment.netMarginPct ?? primary.netMarginPct,
    priceToEarnings: enrichment.priceToEarnings ?? primary.priceToEarnings,
    priceToBook: enrichment.priceToBook ?? primary.priceToBook,
    salesGrowth5YPct: enrichment.salesGrowth5YPct ?? primary.salesGrowth5YPct,
    salesGrowthLabel: enrichment.salesGrowthLabel ?? primary.salesGrowthLabel,
    earningsGrowthPct: enrichment.earningsGrowthPct ?? primary.earningsGrowthPct,
    returnOnEquityPct: enrichment.returnOnEquityPct ?? primary.returnOnEquityPct,
    returnOnEquityLabel: enrichment.returnOnEquityLabel ?? primary.returnOnEquityLabel,
    returnOnCapitalEmployedPct:
      enrichment.returnOnCapitalEmployedPct ?? primary.returnOnCapitalEmployedPct,
    debtToEquity: enrichment.debtToEquity ?? primary.debtToEquity,
    operatingCashFlowCrore: enrichment.operatingCashFlowCrore ?? primary.operatingCashFlowCrore,
    freeCashFlowCrore: enrichment.freeCashFlowCrore ?? primary.freeCashFlowCrore,
    promoterHoldingPct: enrichment.promoterHoldingPct ?? primary.promoterHoldingPct
  } satisfies FundamentalSnapshot);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableNetworkError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("fetch failed") || message.includes("network") || message.includes("timed out");
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function averageScore(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));

  if (!valid.length) {
    return 50;
  }

  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function scaledScore(
  value: number | null,
  min: number,
  max: number,
  options?: {
    lowerIsBetter?: boolean;
    nullScore?: number;
  }
) {
  if (value === null || !Number.isFinite(value)) {
    return options?.nullScore ?? 50;
  }

  if (max === min) {
    return 50;
  }

  const normalized = (value - min) / (max - min);
  const bounded = Math.max(0, Math.min(1, options?.lowerIsBetter ? 1 - normalized : normalized));

  return clampScore(20 + bounded * 80);
}

function sectorDeltaAdjustment(
  value: number | null,
  baseline: number | null,
  higherIsBetter: boolean,
  tolerance: number,
  points: number
) {
  if (value === null || baseline === null || !Number.isFinite(value) || !Number.isFinite(baseline)) {
    return 0;
  }

  const delta = higherIsBetter ? value - baseline : baseline - value;

  if (delta >= tolerance) {
    return points;
  }

  if (delta <= -tolerance) {
    return -points;
  }

  return 0;
}

function sectorRatioAdjustment(
  value: number | null,
  baseline: number | null,
  lowerIsBetter: boolean,
  tolerancePct: number,
  points: number
) {
  if (
    value === null ||
    baseline === null ||
    !Number.isFinite(value) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return 0;
  }

  const ratio = value / baseline;

  if (lowerIsBetter) {
    if (ratio <= 1 - tolerancePct) {
      return points;
    }

    if (ratio >= 1 + tolerancePct) {
      return -points;
    }

    return 0;
  }

  if (ratio >= 1 + tolerancePct) {
    return points;
  }

  if (ratio <= 1 - tolerancePct) {
    return -points;
  }

  return 0;
}

function titleTone(title: string) {
  const lower = title.toLowerCase();
  const positiveHits = POSITIVE_WORDS.filter((keyword) => lower.includes(keyword)).length;
  const negativeHits = NEGATIVE_WORDS.filter((keyword) => lower.includes(keyword)).length;

  if (positiveHits > negativeHits) {
    return "positive" as const;
  }

  if (negativeHits > positiveHits) {
    return "negative" as const;
  }

  return "neutral" as const;
}

function headlineCategory(title: string, source?: string) {
  const lower = title.toLowerCase();
  const normalizedSource = source?.toLowerCase() ?? "";

  if (ANALYST_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return "analyst" as const;
  }

  if (EARNINGS_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return "earnings" as const;
  }

  if (
    normalizedSource.includes("nse") ||
    normalizedSource.includes("announcement") ||
    ANNOUNCEMENT_KEYWORDS.some((keyword) => lower.includes(keyword))
  ) {
    return "announcement" as const;
  }

  return "news" as const;
}

function normalizedMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function publicationTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function headlineRelevanceScore(
  headline: Pick<NewsHeadline, "title" | "source" | "publishedAt" | "tone" | "category">,
  symbol: string,
  companyName: string,
  sector: string
) {
  const normalizedTitle = normalizedMatchText(headline.title);
  const normalizedCompany = normalizedMatchText(companyName);
  const normalizedSector = normalizedMatchText(sector);
  let score = headline.source.toLowerCase().includes("nse") ? 55 : 34;

  if (normalizedTitle.includes(symbol.toLowerCase())) {
    score += 18;
  }

  if (normalizedCompany && normalizedTitle.includes(normalizedCompany)) {
    score += 14;
  }

  if (normalizedSector && normalizedTitle.includes(normalizedSector)) {
    score += 6;
  }

  if (headline.category === "earnings") {
    score += 10;
  } else if (headline.category === "analyst") {
    score += 8;
  } else if (headline.category === "announcement") {
    score += 6;
  }

  if (headline.tone !== "neutral") {
    score += 4;
  }

  const publishedAt = publicationTimestamp(headline.publishedAt);

  if (publishedAt !== null) {
    const ageHours = Math.max(0, (Date.now() - publishedAt) / (1000 * 60 * 60));

    if (ageHours <= 24) {
      score += 10;
    } else if (ageHours <= 72) {
      score += 7;
    } else if (ageHours <= 168) {
      score += 4;
    } else if (ageHours <= 720) {
      score += 1;
    }
  }

  return score;
}

function taggedHeadline(
  headline: Pick<NewsHeadline, "title" | "source" | "publishedAt" | "tone" | "category">,
  symbol: string,
  sector: string
): NewsHeadline {
  return {
    ...headline,
    relevanceScore: headlineRelevanceScore(headline, symbol, headline.title, sector),
    stockTags: [symbol],
    sectorTags: [sector]
  };
}

function enrichHeadline(
  headline: Pick<NewsHeadline, "title" | "source" | "publishedAt" | "tone" | "category">,
  symbol: string,
  companyName: string,
  sector: string
): NewsHeadline {
  return {
    ...headline,
    relevanceScore: headlineRelevanceScore(headline, symbol, companyName, sector),
    stockTags: [symbol],
    sectorTags: [sector]
  };
}

function dedupeAndRankHeadlines(
  headlines: NewsHeadline[],
  limit: number
) {
  const deduped: NewsHeadline[] = [];
  const seen = new Set<string>();

  for (const headline of headlines) {
    const key = `${normalizedMatchText(headline.title)}|${headline.source.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(headline);
  }

  return deduped
    .sort((left, right) => {
      const scoreDelta = (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return (publicationTimestamp(right.publishedAt) ?? 0) - (publicationTimestamp(left.publishedAt) ?? 0);
    })
    .slice(0, limit);
}

function structuredResearchLog(
  level: "info" | "warn",
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
) {
  const payload = {
    event,
    ...fields
  };

  if (level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.info(JSON.stringify(payload));
}

function sentimentScore(headlines: NewsHeadline[]) {
  if (!headlines.length) {
    return 50;
  }

  const toneTotal = headlines.reduce((total, headline) => {
    if (headline.tone === "positive") {
      return total + 1;
    }

    if (headline.tone === "negative") {
      return total - 1;
    }

    return total;
  }, 0);

  return Math.max(0, Math.min(100, 50 + (toneTotal / headlines.length) * 35));
}

function overallSentiment(score: number) {
  if (score >= 58) {
    return "Positive" as const;
  }

  if (score <= 42) {
    return "Negative" as const;
  }

  return "Neutral" as const;
}

async function fetchText(url: string, headers: HeadersInit = {}, retries = 0) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        cache: "no-store",
        headers: {
          Accept: "text/html,application/xml,application/json",
          "User-Agent": "Mozilla/5.0",
          ...headers
        }
      });

      if (!response.ok) {
        const requestError = new Error(`Failed request: ${response.status}`);

        if (attempt < retries && RETRYABLE_HTTP_STATUSES.has(response.status)) {
          lastError = requestError;
          await sleep(300 * (attempt + 1));
          continue;
        }

        throw requestError;
      }

      return response.text();
    } catch (error) {
      lastError = error;

      if (attempt >= retries || !isRetryableNetworkError(error)) {
        throw error;
      }

      await sleep(300 * (attempt + 1));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}

async function fetchJson<T>(url: string, headers: HeadersInit = {}, retries = 0) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
          ...headers
        }
      });

      if (!response.ok) {
        const requestError = new Error(`Failed request: ${response.status}`);

        if (attempt < retries && RETRYABLE_HTTP_STATUSES.has(response.status)) {
          lastError = requestError;
          await sleep(300 * (attempt + 1));
          continue;
        }

        throw requestError;
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;

      if (attempt >= retries || !isRetryableNetworkError(error)) {
        throw error;
      }

      await sleep(300 * (attempt + 1));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}

function cookieHeaderFromResponse(response: Response) {
  const responseHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies =
    typeof responseHeaders.getSetCookie === "function"
      ? responseHeaders.getSetCookie()
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie") ?? ""]
        : [];

  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join("; ");
}

async function getNseCookieHeader(forceRefresh = false) {
  if (!forceRefresh && nseCookieHeader && Date.now() - nseCookieFetchedAt <= NSE_COOKIE_TTL_MS) {
    return nseCookieHeader;
  }

  if (nseCookieRefreshPromise) {
    return nseCookieRefreshPromise;
  }

  nseCookieRefreshPromise = (async () => {
    try {
      const preflight = await fetchWithTimeout(
        "https://www.nseindia.com",
        {
          cache: "no-store",
          headers: NSE_HEADERS
        },
        RESEARCH_PREFLIGHT_TIMEOUT_MS
      );
      const nextCookieHeader = cookieHeaderFromResponse(preflight);

      if (nextCookieHeader) {
        nseCookieHeader = nextCookieHeader;
        nseCookieFetchedAt = Date.now();
      }

      return nseCookieHeader;
    } catch {
      return nseCookieHeader;
    } finally {
      nseCookieRefreshPromise = null;
    }
  })();

  return nseCookieRefreshPromise;
}

async function fetchNseJson<T>(url: string) {
  const fetchAttempt = async (forceCookieRefresh = false) => {
    const cookieHeader = await getNseCookieHeader(forceCookieRefresh);
    return fetchJson<T>(url, cookieHeader ? { ...NSE_HEADERS, Cookie: cookieHeader } : NSE_HEADERS);
  };

  try {
    return await fetchAttempt();
  } catch (error) {
    const message = errorMessage(error);

    if (message.includes("401") || message.includes("403")) {
      return fetchAttempt(true);
    }

    throw error;
  }
}

async function fetchScreenerText(url: string, forceCookieRefresh = false) {
  const screenerHeaders = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    Referer: "https://www.screener.in/",
    Origin: "https://www.screener.in",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0"
  };

  if (
    forceCookieRefresh ||
    !screenerCookieHeader ||
    Date.now() - screenerCookieFetchedAt > SCREENER_COOKIE_TTL_MS
  ) {
    try {
      const preflight = await fetchWithTimeout(
        "https://www.screener.in/",
        {
          cache: "no-store",
          headers: screenerHeaders
        },
        RESEARCH_PREFLIGHT_TIMEOUT_MS
      );
      screenerCookieHeader = cookieHeaderFromResponse(preflight);
      screenerCookieFetchedAt = Date.now();
    } catch {
      if (forceCookieRefresh) {
        screenerCookieHeader = "";
      }
    }
  }

  return fetchText(
    url,
    screenerCookieHeader ? { ...screenerHeaders, Cookie: screenerCookieHeader } : screenerHeaders,
    2
  );
}

function isNseEquityQuote(quote: YahooSearchQuote): quote is YahooSearchQuote & { symbol: string } {
  return quote.exchange === "NSI" && quote.quoteType === "EQUITY" && Boolean(quote.symbol);
}

function toCompanyLookup(quote: YahooSearchQuote & { symbol: string }): CompanyLookup {
  const normalizedSymbol = normalizeSearchSymbol(quote.symbol);

  return {
    symbol: normalizedSymbol,
    yahooSymbol: quote.symbol,
    companyName: quote.longname ?? quote.shortname ?? normalizedSymbol,
    sector: quote.sectorDisp ?? quote.sector ?? "Unknown",
    industry: quote.industryDisp ?? quote.industry ?? undefined
  };
}

function searchRank(lookup: CompanyLookup, normalizedQuery: string) {
  const symbol = lookup.symbol;
  const companyName = lookup.companyName.toUpperCase();

  if (symbol === normalizedQuery) {
    return 0;
  }

  if (symbol.startsWith(normalizedQuery)) {
    return 1;
  }

  if (companyName.startsWith(normalizedQuery)) {
    return 2;
  }

  if (companyName.includes(normalizedQuery)) {
    return 3;
  }

  return 4;
}

async function searchNseQuotes(query: string, limit: number) {
  const normalized = normalizeSearchSymbol(query);

  if (!normalized) {
    return [];
  }

  const payload = await fetchJson<YahooSearchResponse>(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(normalized)}&quotesCount=${Math.max(limit * 2, 8)}&newsCount=0&enableFuzzyQuery=true`
  );
  const matches = (payload.quotes ?? [])
    .filter(isNseEquityQuote)
    .map(toCompanyLookup)
    .sort((left, right) => {
      const leftRank = searchRank(left, normalized);
      const rightRank = searchRank(right, normalized);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.symbol.localeCompare(right.symbol);
    });
  const deduped: CompanyLookup[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (seen.has(match.symbol)) {
      continue;
    }

    seen.add(match.symbol);
    deduped.push(match);

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

export async function lookupNseSuggestions(
  query: string,
  limit = 8
): Promise<StockSearchSuggestion[]> {
  return (await searchNseQuotes(query, limit)).map(({ symbol, companyName, sector, industry }) => ({
    symbol,
    companyName,
    sector,
    industry
  }));
}

export async function lookupNseSymbol(query: string): Promise<CompanyLookup | null> {
  const normalized = normalizeSearchSymbol(query);

  if (!normalized) {
    return null;
  }

  const matches = await searchNseQuotes(normalized, 6);

  return matches.find((match) => match.symbol === normalized) ?? matches[0] ?? null;
}

function parseScreenerFundamentals(html: string) {
  const description = decodeHtmlEntities(
    textContent(/<meta name="description" content="([^"]+)"/i, html) ?? ""
  );
  const plainText = htmlToPlainText(html);
  const metricTexts = [description, plainText].filter(Boolean);

  if (!metricTexts.length) {
    return null;
  }

  const marketCapCrore = numberFromPatterns(metricTexts, [
    /Mkt Cap:\s*([\d,]+)\s*Crore/i,
    /Market Cap(?:italization)?\s*[:\-]?\s*([\d,]+)\s*(?:Cr|Crore)/i
  ]);
  const marketCapChange1YPct = parsePercent(
    textContent(/Mkt Cap:[^(]+\((?:up|down)\s*([\d.]+)% in 1 year\)/i, description)
  );
  const revenueCrore = numberFromPatterns(metricTexts, [
    /Revenue:\s*([\d,]+)\s*Cr/i,
    /Revenue\s*[:\-]?\s*([\d,]+)\s*(?:Cr|Crore)/i,
    /Sales\s*[:\-]?\s*([\d,]+)\s*(?:Cr|Crore)/i
  ]);
  const profitCrore = numberFromPatterns(metricTexts, [
    /Profit:\s*([\d,]+)\s*Cr/i,
    /Net Profit\s*[:\-]?\s*([\d,().-]+)\s*(?:Cr|Crore)/i,
    /Profit after tax\s*[:\-]?\s*([\d,().-]+)\s*(?:Cr|Crore)/i
  ]);
  const salesGrowthLabel = textContent(/company has delivered a ([a-z]+) sales growth/i, description);
  const salesGrowth5YPct =
    numberFromPatterns(metricTexts, [
      /sales growth of ([\d.]+)% over (?:past|last) five years/i,
      /Sales CAGR(?: 5Years| 5Y)?\s*[:\-]?\s*([\d.]+)%/i,
      /(?:3|5)\s*Years?\s*Sales\s*(?:CAGR|growth)\s*[:\-]?\s*([\d.]+)%/i,
      /Sales growth(?:[^%]{0,40})?([\d.]+)%/i
    ]) ?? null;
  const earningsGrowthPct = numberFromPatterns(metricTexts, [
    /profit growth of ([\d.]+)% over past (?:three|five|\d+) years/i,
    /earnings growth of ([\d.]+)% over past (?:three|five|\d+) years/i,
    /(?:Profit|Earnings) CAGR(?: 3Years| 5Years| 3Y| 5Y)?\s*[:\-]?\s*([\d.]+)%/i,
    /(?:3|5)\s*Years?\s*(?:Profit|Earnings)\s*(?:CAGR|growth)\s*[:\-]?\s*([\d.]+)%/i,
    /(?:earnings|profit) growth(?:[^%]{0,40})?([\d.]+)%/i
  ]);
  const returnOnEquityLabel = textContent(/company has a ([a-z]+) return on equity/i, description);
  const returnOnEquityPct =
    numberFromPatterns(metricTexts, [
      /return on equity of ([\d.]+)%/i,
      /return on equity.*?([\d.]+)%/i,
      /(?:3|5)\s*Years?\s*ROE\s*[:\-]?\s*([\d.]+)%/i,
      /ROE\s*[:\-]?\s*([\d.]+)%/i,
      /Return on equity\s*[:\-]?\s*([\d.]+)%/i
    ]) ?? null;
  const returnOnCapitalEmployedPct = numberFromPatterns(metricTexts, [
    /return on capital employed of ([\d.]+)%/i,
    /return on capital employed.*?([\d.]+)%/i,
    /(?:3|5)\s*Years?\s*ROCE\s*[:\-]?\s*([\d.]+)%/i,
    /ROCE\s*[:\-]?\s*([\d.]+)%/i,
    /Return on capital employed\s*[:\-]?\s*([\d.]+)%/i
  ]);
  const priceToEarnings = numberFromPatterns(metricTexts, [
    /P\/E:\s*([\d.()-]+)x/i,
    /(?:Stock\s+)?P\/E\s*[:\-]?\s*([\d.()-]+)/i,
    /Price to earnings(?: ratio)?\s*[:\-]?\s*([\d.()-]+)/i
  ]);
  const priceToBook = numberFromPatterns(metricTexts, [
    /(?:P\/B|Price to book(?: value)?)\s*[:\-]?\s*([\d.()-]+)/i,
    /Book value multiple\s*[:\-]?\s*([\d.()-]+)/i,
    /stock is trading at\s*([\d.()-]+)\s*times its book value/i,
    /trading at\s*([\d.()-]+)\s*times its book value/i
  ]);
  const debtToEquity = numberFromPatterns(metricTexts, [
    /debt(?:\/|\s*to\s*)equity(?: ratio)?\s*(?:is|of)?\s*[:\-]?\s*([\d.()-]+)/i,
    /Debt\/Equity\s*[:\-]?\s*([\d.()-]+)/i
  ]);
  const operatingCashFlowCrore = numberFromPatterns(metricTexts, [
    /(?:Cash from operations|Operating cash flow|Operating cashflow)(?: last year)?\s*(?:is|of)?\s*[:\-]?\s*(?:rs\.?\s*)?([\d,().-]+)\s*(?:Cr|Crore)/i
  ]);
  const freeCashFlowCrore = numberFromPatterns(metricTexts, [
    /(?:Free cash flow|Free cashflow|FCF)(?: last year)?\s*(?:is|of)?\s*[:\-]?\s*(?:rs\.?\s*)?([\d,().-]+)\s*(?:Cr|Crore)/i
  ]);
  const promoterHoldingPct = parsePercent(
    firstPatternMatch(metricTexts, [
      /Promoter Holding:\s*([\d.]+)%/i,
      /Promoter holding\s*[:\-]?\s*([\d.]+)%/i
    ])
  );
  const netMarginPct =
    revenueCrore !== null && profitCrore !== null && revenueCrore !== 0
      ? Number(((profitCrore / revenueCrore) * 100).toFixed(2))
      : null;
  const snapshot = backfillFundamentalSnapshotFromSummary({
    source: "Screener.in",
    summary: description,
    marketCapCrore,
    marketCapChange1YPct,
    revenueCrore,
    profitCrore,
    netMarginPct,
    priceToEarnings,
    priceToBook,
    salesGrowth5YPct,
    salesGrowthLabel,
    earningsGrowthPct,
    returnOnEquityPct,
    returnOnEquityLabel,
    returnOnCapitalEmployedPct,
    debtToEquity,
    operatingCashFlowCrore,
    freeCashFlowCrore,
    promoterHoldingPct
  } satisfies FundamentalSnapshot);

  return hasMeaningfulFundamentalData(snapshot) ? snapshot : null;
}

async function fetchScreenerFundamentals(symbol: string) {
  const candidates = [
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`,
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/`
  ];
  let lastError: unknown = null;

  for (const url of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const html = await fetchScreenerText(url, attempt > 0);
        const parsed = parseScreenerFundamentals(html);

        if (parsed) {
          return parsed;
        }

        lastError = new Error(`No parsable Screener fundamentals were found at ${url}`);
      } catch (error) {
        lastError = error;
      }

      if (attempt === 0) {
        await sleep(350);
      }
    }
  }

  structuredResearchLog("warn", "research.screener", {
    symbol,
    detail: errorMessage(lastError ?? "No parsable Screener fundamentals were found.")
  });

  return null;
}

async function fetchNseQuoteFundamentals(symbol: string, companyName: string) {
  try {
    const [quotePayload, tradePayload] = await Promise.all([
      fetchNseJson<NseQuoteEquityResponse>(
        `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
      ),
      fetchNseJson<NseTradeInfoResponse>(
        `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}&section=trade_info`
      )
    ]);
    const metadata = hasRecord(quotePayload.metadata) ? quotePayload.metadata : undefined;
    const industryInfo = hasRecord(quotePayload.industryInfo) ? quotePayload.industryInfo : undefined;
    const securityInfo = hasRecord(quotePayload.securityInfo) ? quotePayload.securityInfo : undefined;
    const tradeInfo =
      hasRecord(tradePayload.marketDeptOrderBook) && hasRecord(tradePayload.marketDeptOrderBook.tradeInfo)
        ? tradePayload.marketDeptOrderBook.tradeInfo
        : undefined;
    const marketCapCrore = recordNumber(tradeInfo, "totalMarketCap");
    const freeFloatMarketCapCrore = recordNumber(tradeInfo, "ffmc");
    const priceToEarnings = recordNumber(metadata, "pdSymbolPe", "pe", "pE");
    const priceToBook = recordNumber(metadata, "pdSymbolPb", "pdSymbolPbv", "pb", "pB", "bookValue");
    const sectorPe = recordNumber(metadata, "pdSectorPe");
    const faceValue = recordNumber(securityInfo, "faceValue");
    const sector =
      recordString(industryInfo, "sector", "macro") ?? recordString(metadata, "industry") ?? "Unknown";
    const basicIndustry = recordString(industryInfo, "basicIndustry", "industry");
    const summaryParts = [
      `${companyName} fundamentals from NSE India`,
      marketCapCrore !== null ? `Mkt Cap: ${formatSummaryMetric(marketCapCrore, " Crore", 0)}` : null,
      priceToEarnings !== null ? `P/E: ${formatSummaryMetric(priceToEarnings, "x", 2)}` : null,
      priceToBook !== null ? `P/B: ${formatSummaryMetric(priceToBook, "x", 2)}` : null,
      sectorPe !== null ? `Sector P/E: ${formatSummaryMetric(sectorPe, "x", 2)}` : null,
      basicIndustry ? `Industry: ${basicIndustry}` : sector !== "Unknown" ? `Sector: ${sector}` : null,
      freeFloatMarketCapCrore !== null
        ? `Free-float MCap: ${formatSummaryMetric(freeFloatMarketCapCrore, " Crore", 0)}`
        : null,
      faceValue !== null ? `Face value: ${formatSummaryMetric(faceValue, "", 0)}` : null
    ].filter((value): value is string => Boolean(value));
    const snapshot = backfillFundamentalSnapshotFromSummary({
      source: "NSE India",
      summary: summaryParts.join(" · "),
      marketCapCrore,
      marketCapChange1YPct: null,
      revenueCrore: null,
      profitCrore: null,
      netMarginPct: null,
      priceToEarnings,
      priceToBook,
      salesGrowth5YPct: null,
      salesGrowthLabel: null,
      earningsGrowthPct: null,
      returnOnEquityPct: null,
      returnOnEquityLabel: null,
      returnOnCapitalEmployedPct: null,
      debtToEquity: null,
      operatingCashFlowCrore: null,
      freeCashFlowCrore: null,
      promoterHoldingPct: null
    } satisfies FundamentalSnapshot);

    return hasMeaningfulFundamentalData(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

async function fetchYahooFundamentals(yahooSymbol: string, companyName: string) {
  try {
    const payload = await fetchJson<YahooQuoteSummaryResponse>(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=summaryDetail,financialData,defaultKeyStatistics&formatted=false`
    );
    const result = payload.quoteSummary?.result?.[0];

    if (!result) {
      return null;
    }

    const summaryDetail = hasRecord(result.summaryDetail) ? result.summaryDetail : undefined;
    const financialData = hasRecord(result.financialData) ? result.financialData : undefined;
    const defaultKeyStatistics = hasRecord(result.defaultKeyStatistics) ? result.defaultKeyStatistics : undefined;

    const marketCapCrore =
      toCrore(yahooNumberField(summaryDetail, "marketCap")) ??
      toCrore(yahooNumberField(defaultKeyStatistics, "marketCap"));
    const revenueCrore = toCrore(yahooNumberField(financialData, "totalRevenue"));
    const operatingCashFlowCrore = toCrore(yahooNumberField(financialData, "operatingCashflow"));
    const freeCashFlowCrore =
      toCrore(yahooNumberField(financialData, "freeCashflow")) ??
      toCrore(yahooNumberField(defaultKeyStatistics, "freeCashflow"));
    const netMarginPct = yahooPercentField(financialData, "profitMargins");
    const priceToEarnings =
      yahooNumberField(summaryDetail, "trailingPE") ?? yahooNumberField(defaultKeyStatistics, "trailingPE");
    const priceToBook =
      yahooNumberField(summaryDetail, "priceToBook") ?? yahooNumberField(defaultKeyStatistics, "priceToBook");
    const marketCapChange1YPct = yahooPercentField(defaultKeyStatistics, "52WeekChange");
    const earningsGrowthPct = yahooPercentField(financialData, "earningsGrowth");
    const returnOnEquityPct = yahooPercentField(financialData, "returnOnEquity");
    const debtToEquity = normalizeDebtToEquity(yahooNumberField(financialData, "debtToEquity"));
    const profitCrore =
      revenueCrore !== null && netMarginPct !== null
        ? Number(((revenueCrore * netMarginPct) / 100).toFixed(2))
        : null;
    const summaryParts = [
      `${companyName} fundamentals from Yahoo Finance`,
      marketCapCrore !== null ? `Mkt Cap: ${formatSummaryMetric(marketCapCrore, " Crore", 0)}` : null,
      revenueCrore !== null ? `Revenue: ${formatSummaryMetric(revenueCrore, " Cr", 0)}` : null,
      priceToEarnings !== null ? `P/E: ${formatSummaryMetric(priceToEarnings, "x", 1)}` : null,
      priceToBook !== null ? `P/B: ${formatSummaryMetric(priceToBook, "x", 1)}` : null,
      returnOnEquityPct !== null ? `ROE: ${formatSummaryMetric(returnOnEquityPct, "%", 1)}` : null
    ].filter((value): value is string => Boolean(value));
    const snapshot = backfillFundamentalSnapshotFromSummary({
      source: "Yahoo Finance",
      summary: summaryParts.join(" · "),
      marketCapCrore,
      marketCapChange1YPct,
      revenueCrore,
      profitCrore,
      netMarginPct,
      priceToEarnings,
      priceToBook,
      salesGrowth5YPct: null,
      salesGrowthLabel: null,
      earningsGrowthPct,
      returnOnEquityPct,
      returnOnEquityLabel: yahooReturnOnEquityLabel(returnOnEquityPct),
      returnOnCapitalEmployedPct: null,
      debtToEquity,
      operatingCashFlowCrore,
      freeCashFlowCrore,
      promoterHoldingPct: null
    } satisfies FundamentalSnapshot);

    return hasMeaningfulFundamentalData(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

function buildSentimentSnapshot(
  headlines: NewsHeadline[],
  query: string
) {
  const score = Number(sentimentScore(headlines).toFixed(2));

  return {
    query,
    overall: overallSentiment(score),
    score,
    positiveCount: headlines.filter((headline) => headline.tone === "positive").length,
    neutralCount: headlines.filter((headline) => headline.tone === "neutral").length,
    negativeCount: headlines.filter((headline) => headline.tone === "negative").length,
    earningsMentionCount: headlines.filter((headline) => headline.category === "earnings").length,
    analystMentionCount: headlines.filter((headline) => headline.category === "analyst").length,
    announcementCount: headlines.filter((headline) => headline.category === "announcement").length,
    headlines
  } satisfies SentimentSnapshot;
}

function stringField(record: NseAnnouncementItem, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

async function fetchGoogleNewsHeadlines(companyName: string, symbol: string, sector: string) {
  const query = `"${companyName}" OR ${symbol} NSE stock when:30d`;
  const xml = await fetchText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`
  );
  const headlines: NewsHeadline[] = [];

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const rawTitle = textContent(/<title>([\s\S]*?)<\/title>/i, item);

    if (!rawTitle) {
      continue;
    }

    const title = decodeHtmlEntities(rawTitle).replace(/\s+-\s+[^-]+$/, "").trim();
    const source = decodeHtmlEntities(textContent(/<source[^>]*>([\s\S]*?)<\/source>/i, item) ?? "Google News");
    const publishedAt = textContent(/<pubDate>([\s\S]*?)<\/pubDate>/i, item) ?? "";

    headlines.push(
      enrichHeadline(
        {
          title,
          source,
          publishedAt,
          tone: titleTone(title),
          category: headlineCategory(title, source)
        },
        symbol,
        companyName,
        sector
      )
    );

    if (headlines.length >= 8) {
      break;
    }
  }

  return headlines;
}

async function fetchNseAnnouncementHeadlines(symbol: string, companyName: string, sector: string) {
  const payload = await fetchNseJson<NseAnnouncementResponse>(
    `https://www.nseindia.com/api/corporate-announcements?symbol=${encodeURIComponent(symbol)}`
  );
  const records = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

  return records
    .map((record) => {
      const title =
        stringField(record, "desc", "subject", "sm_name", "an_desc", "headline", "attchmntText") ?? null;

      if (!title) {
        return null;
      }

      const publishedAt =
        stringField(
          record,
          "sort_date",
          "date",
          "broadcastDateTime",
          "broadcastDate",
          "announcementDate",
          "dt"
        ) ?? "";

      return enrichHeadline(
        {
          title: decodeHtmlEntities(title),
          source: "NSE Announcements",
          publishedAt,
          tone: titleTone(title),
          category: headlineCategory(title, "NSE Announcements")
        },
        symbol,
        companyName,
        sector
      );
    })
    .filter((headline): headline is NewsHeadline => headline !== null)
    .slice(0, 8);
}

function statusForSource(
  provider: string,
  state: ResearchSourceStatus["state"],
  detail: string,
  itemCount?: number
): ResearchSourceStatus {
  return {
    provider,
    state,
    detail,
    observedAt: new Date().toISOString(),
    itemCount
  };
}

export async function fetchCompanyResearch(
  lookup: CompanyLookup,
  cachedResearch: CachedResearch = null
): Promise<CompanyResearch> {
  const [
    nseFundamentalsLive,
    screenerFundamentalsLive,
    yahooFundamentalsLive,
    nseHeadlinesResult,
    googleHeadlinesResult
  ] =
    await Promise.allSettled([
    fetchNseQuoteFundamentals(lookup.symbol, lookup.companyName),
    fetchScreenerFundamentals(lookup.symbol),
    fetchYahooFundamentals(lookup.yahooSymbol, lookup.companyName),
    fetchNseAnnouncementHeadlines(lookup.symbol, lookup.companyName, lookup.sector),
    fetchGoogleNewsHeadlines(lookup.companyName, lookup.symbol, lookup.sector)
    ]);

  const nseLive = nseFundamentalsLive.status === "fulfilled" ? nseFundamentalsLive.value : null;
  const screenerLive =
    screenerFundamentalsLive.status === "fulfilled" ? screenerFundamentalsLive.value : null;
  const yahooLive = yahooFundamentalsLive.status === "fulfilled" ? yahooFundamentalsLive.value : null;
  const liveFundamentals =
    nseLive && screenerLive
      ? {
          provider: "NSE India + Screener.in",
          detail: "Live fundamentals loaded from NSE India and enriched with Screener.in fields.",
          snapshot: mergeFundamentalSnapshots(nseLive, screenerLive, "NSE India + Screener.in")
        }
      : nseLive && yahooLive
        ? {
            provider: "NSE India + Yahoo Finance",
            detail:
              "Live fundamentals loaded from NSE India and supplemented with Yahoo Finance fallback fields.",
            snapshot: mergeFundamentalSnapshots(nseLive, yahooLive, "NSE India + Yahoo Finance")
          }
        : nseLive
          ? {
              provider: "NSE India",
              detail: "Live fundamentals loaded from NSE India quote endpoints.",
              snapshot: nseLive
            }
        : screenerLive
          ? {
              provider: "Screener.in",
              detail:
                "NSE fundamentals were unavailable in this batch, so Screener.in supplied the live fallback.",
              snapshot: screenerLive
            }
          : yahooLive
            ? {
                provider: "Yahoo Finance",
                detail:
                  "NSE and Screener fundamentals were unavailable in this batch, so Yahoo Finance supplied the live fallback.",
                snapshot: yahooLive
              }
        : null;

  const fundamentals = (() => {
    if (liveFundamentals) {
      return liveFundamentals.snapshot;
    }

    return cachedResearch?.fundamentals ?? null;
  })();
  const fundamentalsStatus =
    liveFundamentals
      ? statusForSource(liveFundamentals.provider, "live", liveFundamentals.detail, 1)
      : cachedResearch?.fundamentals
        ? statusForSource(
            cachedResearch.fundamentals.source,
            "cached",
            "Live fundamental providers were unavailable in this batch, so the most recent cached snapshot was reused.",
            1
          )
        : statusForSource(
            "NSE India + Screener.in + Yahoo Finance",
            "unavailable",
            "Live fundamental providers were unavailable in this batch and no cached snapshot existed for fallback.",
            0
          );

  const liveHeadlines = dedupeAndRankHeadlines(
    [
      ...(nseHeadlinesResult.status === "fulfilled" ? nseHeadlinesResult.value : []),
      ...(googleHeadlinesResult.status === "fulfilled" ? googleHeadlinesResult.value : [])
    ],
    8
  );
  const sentimentLive =
    liveHeadlines.length > 0
      ? buildSentimentSnapshot(liveHeadlines, `${lookup.companyName} | ${lookup.symbol} | ${lookup.sector}`)
      : null;
  const sentiment = sentimentLive ?? cachedResearch?.sentiment ?? null;
  const nseCount = nseHeadlinesResult.status === "fulfilled" ? nseHeadlinesResult.value.length : 0;
  const googleCount = googleHeadlinesResult.status === "fulfilled" ? googleHeadlinesResult.value.length : 0;
  const sentimentStatus =
    sentimentLive
      ? statusForSource(
          "NSE Announcements + Google News",
          "live",
          `${liveHeadlines.length} tagged headlines loaded (${nseCount} from NSE announcements, ${googleCount} from Google News).`,
          liveHeadlines.length
        )
      : cachedResearch?.sentiment
        ? statusForSource(
            "NSE Announcements + Google News",
            "cached",
            "Live headline sources were unavailable in this batch, so the most recent cached tagged headlines were reused.",
            cachedResearch.sentiment.headlines.length
          )
        : statusForSource(
            "NSE Announcements + Google News",
            "unavailable",
            "Live headline sources were unavailable in this batch and no cached tagged headlines existed for fallback.",
            0
          );

  if (fundamentalsStatus.state !== "live") {
    structuredResearchLog("warn", "research.fundamentals", {
      symbol: lookup.symbol,
      state: fundamentalsStatus.state,
      detail: fundamentalsStatus.detail
    });
  }

  if (sentimentStatus.state !== "live") {
    structuredResearchLog("warn", "research.sentiment", {
      symbol: lookup.symbol,
      state: sentimentStatus.state,
      detail: sentimentStatus.detail
    });
  }

  return {
    companyName: lookup.companyName,
    sector: lookup.sector,
    industry: lookup.industry,
    fundamentals,
    sentiment,
    researchStatus: {
      fundamentals: fundamentalsStatus,
      sentiment: sentimentStatus
    }
  };
}

export function scoreFundamentals(
  fundamentals: FundamentalSnapshot | null,
  sectorContext: FundamentalSectorContext | null = null
) {
  if (!fundamentals) {
    return 50;
  }

  const growthScore = averageScore([
    scaledScore(fundamentals.salesGrowth5YPct, 0, 18),
    scaledScore(fundamentals.earningsGrowthPct, 0, 20)
  ]);
  const returnsScore = averageScore([
    scaledScore(fundamentals.returnOnEquityPct, 8, 24),
    scaledScore(fundamentals.returnOnCapitalEmployedPct, 8, 24)
  ]);
  const valuationScore = averageScore([
    fundamentals.priceToEarnings !== null && fundamentals.priceToEarnings <= 0
      ? 15
      : scaledScore(fundamentals.priceToEarnings, 8, 42, { lowerIsBetter: true }),
    scaledScore(fundamentals.priceToBook, 1, 7, { lowerIsBetter: true })
  ]);
  const leverageScore = scaledScore(fundamentals.debtToEquity, 0, 1.6, { lowerIsBetter: true });
  const marginScore = scaledScore(fundamentals.netMarginPct, 4, 20);
  const cashFlowScore = averageScore([
    fundamentals.operatingCashFlowCrore === null
      ? 50
      : fundamentals.operatingCashFlowCrore > 0
        ? scaledScore(
            fundamentals.revenueCrore
              ? (fundamentals.operatingCashFlowCrore / fundamentals.revenueCrore) * 100
              : 8,
            0,
            18
          )
        : 12,
    fundamentals.freeCashFlowCrore === null
      ? 50
      : fundamentals.freeCashFlowCrore > 0
        ? scaledScore(
            fundamentals.revenueCrore
              ? (fundamentals.freeCashFlowCrore / fundamentals.revenueCrore) * 100
              : 5,
            -3,
            12
          )
        : 10
  ]);
  const promoterScore =
    fundamentals.promoterHoldingPct === null ? 50 : clampScore(25 + fundamentals.promoterHoldingPct);
  const labelBonus =
    (fundamentals.salesGrowthLabel === "strong" || fundamentals.salesGrowthLabel === "high" ? 7 : 0) +
    (fundamentals.returnOnEquityLabel === "high" || fundamentals.returnOnEquityLabel === "good" ? 6 : 0) -
    (fundamentals.salesGrowthLabel === "poor" ? 8 : 0) -
    (fundamentals.returnOnEquityLabel === "low" ? 8 : 0);
  const sectorAdjustment =
    sectorContext && sectorContext.peerCount >= 3
      ? sectorDeltaAdjustment(
          fundamentals.salesGrowth5YPct,
          sectorContext.medianSalesGrowth5YPct,
          true,
          2,
          3
        ) +
        sectorDeltaAdjustment(
          fundamentals.earningsGrowthPct,
          sectorContext.medianEarningsGrowthPct,
          true,
          2,
          3
        ) +
        sectorDeltaAdjustment(
          fundamentals.returnOnEquityPct,
          sectorContext.medianReturnOnEquityPct,
          true,
          1.5,
          4
        ) +
        sectorDeltaAdjustment(
          fundamentals.returnOnCapitalEmployedPct,
          sectorContext.medianReturnOnCapitalEmployedPct,
          true,
          1.5,
          4
        ) +
        sectorDeltaAdjustment(
          fundamentals.debtToEquity,
          sectorContext.medianDebtToEquity,
          false,
          0.15,
          3
        ) +
        sectorRatioAdjustment(
          fundamentals.priceToEarnings,
          sectorContext.medianPriceToEarnings,
          true,
          0.12,
          2
        ) +
        sectorRatioAdjustment(
          fundamentals.priceToBook,
          sectorContext.medianPriceToBook,
          true,
          0.12,
          2
        )
      : 0;

  return Number(
    clampScore(
      growthScore * 0.23 +
        returnsScore * 0.24 +
        valuationScore * 0.14 +
        leverageScore * 0.12 +
        cashFlowScore * 0.13 +
        marginScore * 0.08 +
        promoterScore * 0.06 +
        labelBonus +
        sectorAdjustment
    ).toFixed(2)
  );
}

export function scoreSentiment(sentiment: SentimentSnapshot | null) {
  return sentiment?.score ?? 50;
}

export function scoreEarningsSignal(sentiment: SentimentSnapshot | null) {
  if (!sentiment) {
    return 50;
  }

  const earningsHeadlines = sentiment.headlines.filter((headline) => headline.category === "earnings");

  if (!earningsHeadlines.length) {
    return 50;
  }

  const averageTone =
    earningsHeadlines.reduce((total, headline) => {
      if (headline.tone === "positive") {
        return total + 1;
      }

      if (headline.tone === "negative") {
        return total - 1;
      }

      return total;
    }, 0) / earningsHeadlines.length;

  return Number(Math.max(0, Math.min(100, 50 + averageTone * 30)).toFixed(2));
}

export function scoreAnalystSignal(sentiment: SentimentSnapshot | null) {
  if (!sentiment) {
    return 50;
  }

  const analystHeadlines = sentiment.headlines.filter((headline) => headline.category === "analyst");

  if (!analystHeadlines.length) {
    return 50;
  }

  const averageTone =
    analystHeadlines.reduce((total, headline) => {
      if (headline.tone === "positive") {
        return total + 1;
      }

      if (headline.tone === "negative") {
        return total - 1;
      }

      return total;
    }, 0) / analystHeadlines.length;

  return Number(Math.max(0, Math.min(100, 50 + averageTone * 35)).toFixed(2));
}
