from typing import Literal

from pydantic import BaseModel

HorizonId = Literal["single_day", "swing", "position", "long_term"]
Conviction = Literal["High", "Medium", "Low"]
OutcomeResult = Literal["target_hit", "stop_loss_hit", "open"]
AnalysisArea = Literal["technical", "fundamental", "sentiment", "earnings", "analyst", "risk"]
AnalysisImpact = Literal["positive", "negative", "neutral"]
HeadlineTone = Literal["positive", "neutral", "negative"]
HeadlineCategory = Literal["news", "earnings", "analyst", "announcement"]
ResearchSourceState = Literal["live", "cached", "unavailable"]


class Signal(BaseModel):
    name: str
    value: str


class AnalysisDriver(BaseModel):
    area: AnalysisArea
    impact: AnalysisImpact
    title: str
    detail: str


class NewsHeadline(BaseModel):
    title: str
    source: str
    publishedAt: str
    tone: HeadlineTone
    category: HeadlineCategory
    relevanceScore: float | None = None
    stockTags: list[str] | None = None
    sectorTags: list[str] | None = None


class FundamentalSnapshot(BaseModel):
    source: str
    summary: str
    marketCapCrore: float | None = None
    marketCapChange1YPct: float | None = None
    revenueCrore: float | None = None
    profitCrore: float | None = None
    netMarginPct: float | None = None
    priceToEarnings: float | None = None
    priceToBook: float | None = None
    salesGrowth5YPct: float | None = None
    salesGrowthLabel: str | None = None
    earningsGrowthPct: float | None = None
    returnOnEquityPct: float | None = None
    returnOnEquityLabel: str | None = None
    returnOnCapitalEmployedPct: float | None = None
    debtToEquity: float | None = None
    operatingCashFlowCrore: float | None = None
    freeCashFlowCrore: float | None = None
    promoterHoldingPct: float | None = None


class SentimentSnapshot(BaseModel):
    query: str
    overall: Literal["Positive", "Neutral", "Negative"]
    score: float
    positiveCount: int
    neutralCount: int
    negativeCount: int
    earningsMentionCount: int
    analystMentionCount: int
    announcementCount: int = 0
    headlines: list[NewsHeadline]


class ResearchSourceStatus(BaseModel):
    provider: str
    state: ResearchSourceState
    detail: str
    observedAt: str
    itemCount: int | None = None


class StockResearchStatus(BaseModel):
    fundamentals: ResearchSourceStatus
    sentiment: ResearchSourceStatus


class RecommendationOutcome(BaseModel):
    result: OutcomeResult
    evaluatedOn: str
    holdingDays: int
    returnPct: float
    notes: str


class RecommendationPlan(BaseModel):
    score: float | None = None
    rank: int | None = None
    isRecommended: bool = True
    conviction: Conviction
    entryPrice: float
    targetPrice: float
    stopLoss: float
    expectedReturnPct: float
    riskReward: float
    summary: str
    drivers: list[str]
    analysisDrivers: list[AnalysisDriver] | None = None
    technicalSignals: list[Signal]
    fundamentalSignals: list[Signal]
    sentimentSignals: list[Signal] | None = None
    earningsSignals: list[Signal] | None = None
    analystSignals: list[Signal] | None = None
    riskSignals: list[Signal] | None = None
    newsContext: list[str]


class HistoricalRecommendationPlan(BaseModel):
    score: float | None = None
    rank: int | None = None
    isRecommended: bool = True
    conviction: Conviction
    entryPrice: float
    targetPrice: float
    stopLoss: float
    summary: str
    outcome: RecommendationOutcome


class StockAnalysis(BaseModel):
    symbol: str
    companyName: str
    sector: str
    industry: str | None = None
    marketCapBucket: str
    liquidityTier: str
    currentMarketPrice: float
    latestSessionChangePct: float | None = None
    fundamentals: FundamentalSnapshot | None = None
    sentiment: SentimentSnapshot | None = None
    researchStatus: StockResearchStatus | None = None
    profiles: dict[HorizonId, RecommendationPlan]


class HistoricalStockRecommendation(BaseModel):
    symbol: str
    companyName: str
    sector: str
    profiles: dict[HorizonId, HistoricalRecommendationPlan]


class HorizonProfile(BaseModel):
    id: HorizonId
    label: str
    window: str


class RecommendationBatch(BaseModel):
    batchDate: str
    generatedAt: str
    recommendations: list[StockAnalysis]


class HistoricalBatch(BaseModel):
    batchDate: str
    publishedAt: str
    recommendations: list[HistoricalStockRecommendation]


class RecommendationDataset(BaseModel):
    market: str
    exchange: str
    universe: str
    dataSource: dict | None = None
    profiles: list[HorizonProfile]
    currentBatch: RecommendationBatch
    history: list[HistoricalBatch]


class RecommendationSummary(BaseModel):
    symbol: str
    companyName: str
    sector: str
    currentMarketPrice: float
    horizon: HorizonId
    score: float | None = None
    rank: int | None = None
    isRecommended: bool = True
    conviction: Conviction
    entryPrice: float
    targetPrice: float
    stopLoss: float
    expectedReturnPct: float
    riskReward: float
    summary: str


class DailyPerformance(BaseModel):
    batchDate: str
    publishedAt: str
    total: int
    closed: int
    open: int
    successful: int
    failed: int
    successRate: float | None
    averageReturnPct: float | None


class StockPerformanceHistoryEntry(BaseModel):
    batchDate: str
    publishedAt: str
    symbol: str
    companyName: str
    sector: str
    horizon: HorizonId
    conviction: Conviction
    entryPrice: float
    targetPrice: float
    stopLoss: float
    summary: str
    outcome: RecommendationOutcome


class StockDetailResponse(BaseModel):
    generatedAt: str
    batchDate: str
    market: str
    exchange: str
    universe: str
    selectedHorizon: HorizonId
    stock: StockAnalysis
    history: list[StockPerformanceHistoryEntry]
