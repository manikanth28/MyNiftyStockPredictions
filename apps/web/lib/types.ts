export type HorizonId = "single_day" | "swing" | "position" | "long_term";
export type OutcomeResult = "target_hit" | "stop_loss_hit" | "open";
export type DataSourceMode = "live" | "cached" | "sample";
export type HeadlineTone = "positive" | "neutral" | "negative";
export type HeadlineCategory = "news" | "earnings" | "analyst" | "announcement";
export type ResearchSourceState = "live" | "cached" | "unavailable";

export type Signal = {
  name: string;
  value: string;
};

export type AnalysisArea =
  | "technical"
  | "fundamental"
  | "sentiment"
  | "earnings"
  | "analyst"
  | "risk";
export type AnalysisImpact = "positive" | "negative" | "neutral";

export type AnalysisDriver = {
  area: AnalysisArea;
  impact: AnalysisImpact;
  title: string;
  detail: string;
};

export type NewsHeadline = {
  title: string;
  source: string;
  publishedAt: string;
  tone: HeadlineTone;
  category: HeadlineCategory;
  relevanceScore?: number;
  stockTags?: string[];
  sectorTags?: string[];
};

export type FundamentalSnapshot = {
  source: string;
  summary: string;
  marketCapCrore: number | null;
  marketCapChange1YPct: number | null;
  revenueCrore: number | null;
  profitCrore: number | null;
  netMarginPct: number | null;
  priceToEarnings: number | null;
  priceToBook: number | null;
  salesGrowth5YPct: number | null;
  salesGrowthLabel: string | null;
  earningsGrowthPct: number | null;
  returnOnEquityPct: number | null;
  returnOnEquityLabel: string | null;
  returnOnCapitalEmployedPct: number | null;
  debtToEquity: number | null;
  operatingCashFlowCrore: number | null;
  freeCashFlowCrore: number | null;
  promoterHoldingPct: number | null;
};

export type SentimentSnapshot = {
  query: string;
  overall: "Positive" | "Neutral" | "Negative";
  score: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  earningsMentionCount: number;
  analystMentionCount: number;
  announcementCount: number;
  headlines: NewsHeadline[];
};

export type ResearchSourceStatus = {
  provider: string;
  state: ResearchSourceState;
  detail: string;
  observedAt: string;
  itemCount?: number;
};

export type StockResearchStatus = {
  fundamentals: ResearchSourceStatus;
  sentiment: ResearchSourceStatus;
};

export type StockSearchSuggestion = {
  symbol: string;
  companyName: string;
  sector: string;
  industry?: string;
};

export type RecommendationPlan = {
  score?: number;
  rank?: number;
  isRecommended?: boolean;
  conviction: "High" | "Medium" | "Low";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  expectedReturnPct: number;
  riskReward: number;
  summary: string;
  drivers: string[];
  analysisDrivers?: AnalysisDriver[];
  technicalSignals: Signal[];
  fundamentalSignals: Signal[];
  sentimentSignals?: Signal[];
  earningsSignals?: Signal[];
  analystSignals?: Signal[];
  riskSignals?: Signal[];
  newsContext: string[];
};

export type StockAnalysis = {
  symbol: string;
  companyName: string;
  sector: string;
  industry?: string;
  marketCapBucket: string;
  liquidityTier: string;
  currentMarketPrice: number;
  latestSessionChangePct?: number | null;
  fundamentals?: FundamentalSnapshot | null;
  sentiment?: SentimentSnapshot | null;
  researchStatus?: StockResearchStatus;
  profiles: Record<HorizonId, RecommendationPlan>;
};

export type RecommendationOutcome = {
  result: OutcomeResult;
  evaluatedOn: string;
  holdingDays: number;
  returnPct: number;
  notes: string;
};

export type HistoricalRecommendationPlan = {
  score?: number;
  rank?: number;
  isRecommended?: boolean;
  conviction: "High" | "Medium" | "Low";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  summary: string;
  outcome: RecommendationOutcome;
};

export type HistoricalStockRecommendation = {
  symbol: string;
  companyName: string;
  sector: string;
  profiles: Record<HorizonId, HistoricalRecommendationPlan>;
};

export type HorizonProfile = {
  id: HorizonId;
  label: string;
  window: string;
};

export type RecommendationBatch = {
  batchDate: string;
  generatedAt: string;
  recommendations: StockAnalysis[];
};

export type HistoricalBatch = {
  batchDate: string;
  publishedAt: string;
  recommendations: HistoricalStockRecommendation[];
};

export type DailyPerformance = {
  batchDate: string;
  publishedAt: string;
  total: number;
  closed: number;
  open: number;
  successful: number;
  failed: number;
  successRate: number | null;
  averageReturnPct: number | null;
};

export type StockPerformanceHistoryEntry = {
  batchDate: string;
  publishedAt: string;
  symbol: string;
  companyName: string;
  sector: string;
  horizon: HorizonId;
  conviction: "High" | "Medium" | "Low";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  summary: string;
  outcome: RecommendationOutcome;
};

export type DataSourceInfo = {
  mode: DataSourceMode;
  provider: string;
  asOf: string;
  detail: string;
  analyzedSymbols: number;
  researchCoverage?: {
    fundamentalsLive: number;
    fundamentalsCached: number;
    fundamentalsUnavailable: number;
    sentimentLive: number;
    sentimentCached: number;
    sentimentUnavailable: number;
    nseAnnouncementHeadlines: number;
    googleNewsHeadlines: number;
  };
};

export type SearchAnalysisResult = {
  status: "analyzed" | "not_found" | "error";
  query: string;
  symbol: string;
  companyName: string;
  sector: string;
  industry?: string;
  shouldConsider: boolean;
  verdict: string;
  recommendedHorizons: HorizonId[];
  stock: StockAnalysis | null;
  message?: string;
};

export type RecommendationDataset = {
  market: string;
  exchange: string;
  universe: string;
  dataSource?: DataSourceInfo;
  profiles: HorizonProfile[];
  currentBatch: RecommendationBatch;
  history: HistoricalBatch[];
};
