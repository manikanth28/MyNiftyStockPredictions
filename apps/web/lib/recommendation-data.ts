import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fetchCompanyResearch,
  lookupNseSymbol,
  scoreAnalystSignal,
  scoreEarningsSignal,
  scoreFundamentals,
  scoreSentiment
} from "@/lib/company-research";
import type { FundamentalSectorContext } from "@/lib/company-research";
import { BENCHMARK, NIFTY_100_UNIVERSE } from "@/lib/market-universe";
import type { UniverseEntry } from "@/lib/market-universe";
import type {
  AnalysisDriver,
  DataSourceInfo,
  HistoricalBatch,
  HistoricalRecommendationPlan,
  HistoricalStockRecommendation,
  HorizonId,
  HorizonProfile,
  OutcomeResult,
  RecommendationDataset,
  RecommendationOutcome,
  RecommendationPlan,
  SearchAnalysisResult,
  Signal,
  StockAnalysis,
  StockResearchStatus
} from "@/lib/types";

type HorizonSettings = {
  id: HorizonId;
  label: string;
  window: string;
  recommendationCount: number;
  minimumScore: number;
  minimumRiskReward: number;
  targetRangePct: [number, number];
  stopRangePct: [number, number];
  atrTargetMultiple: number;
  atrStopMultiple: number;
  maxHoldDays: number;
};

type PriceBar = {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartMeta = {
  regularMarketPrice?: number;
  regularMarketTime?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  longName?: string;
  shortName?: string;
  chartPreviousClose?: number;
};

type MarketSeries = UniverseEntry & {
  companyName: string;
  bars: PriceBar[];
  indexByDate: Map<string, number>;
  meta: ChartMeta;
  fundamentals: StockAnalysis["fundamentals"];
  sentiment: StockAnalysis["sentiment"];
  researchStatus?: StockResearchStatus;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: ChartMeta;
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      description?: string;
    };
  };
};

type SnapshotMetrics = {
  date: string;
  companyName: string;
  currentPrice: number;
  previousClose: number | null;
  sessionChangePct: number | null;
  openingGapPct: number | null;
  closeLocationPct: number | null;
  candleBodyPct: number | null;
  upperWickPct: number | null;
  lowerWickPct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma20Slope5Pct: number | null;
  sma50Slope10Pct: number | null;
  rsi14: number | null;
  macdLinePct: number | null;
  macdSignalPct: number | null;
  macdHistogramPct: number | null;
  atr14: number | null;
  atrPct: number | null;
  return20: number | null;
  return60: number | null;
  return120: number | null;
  breakout20Pct: number | null;
  breakout55Pct: number | null;
  breakout120Pct: number | null;
  rangeCompression5v20: number | null;
  benchmarkReturn20: number | null;
  benchmarkReturn60: number | null;
  benchmarkReturn120: number | null;
  relativeStrength20: number | null;
  relativeStrength60: number | null;
  relativeStrength120: number | null;
  volatility20: number | null;
  avgVolume20: number | null;
  volumeRatio: number | null;
  volumeTrend20Pct: number | null;
  rangePosition: number | null;
  bollingerPositionPct: number | null;
  bollingerBandwidthPct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  distanceFromHighPct: number | null;
  distanceFromLowPct: number | null;
  benchmarkSessionChangePct: number | null;
  currentVolume: number;
  candlestickPattern: string | null;
  trendClassification: "Bullish" | "Neutral" | "Bearish";
};

type PlanTemplate = Omit<RecommendationPlan, "rank" | "isRecommended">;

type StopLossLearning = {
  penalty: number;
  recentStopLosses: number;
  quickStopLosses: number;
  note: string | null;
};

type StopLossLearningMap = Map<string, Partial<Record<HorizonId, StopLossLearning>>>;

type DatasetCacheEntry = {
  dataset: RecommendationDataset;
  cachedAt: number;
};

type RefreshJobState = "idle" | "running" | "succeeded" | "failed";

export type RecommendationRefreshStatus = {
  scope: "all";
  state: RefreshJobState;
  phase: string;
  detail: string;
  percentComplete: number;
  percentRemaining: number;
  processedSymbols: number;
  totalSymbols: number;
  startedAt: string | null;
  finishedAt: string | null;
  generatedAt: string | null;
  error: string | null;
};

export type LatestPriceSnapshot = {
  currentMarketPrice: number;
  latestSessionChangePct: number | null;
  dayStartPrice: number | null;
  asOf: string | null;
};

type SectorFundamentalSource = {
  sector: string;
  fundamentals: StockAnalysis["fundamentals"];
};

type CachedResearchSource = Pick<StockAnalysis, "fundamentals" | "sentiment" | "researchStatus">;
type ResearchCoverage = NonNullable<DataSourceInfo["researchCoverage"]>;

const MARKET_UNIVERSE = NIFTY_100_UNIVERSE;
const PRICE_OVERLAY_RANGE = "5d";
const PRICE_OVERLAY_CONCURRENCY = 6;

const HORIZON_SETTINGS: Record<HorizonId, HorizonSettings> = {
  single_day: {
    id: "single_day",
    label: "Single-day",
    window: "Next trading day",
    recommendationCount: 10,
    minimumScore: 54,
    minimumRiskReward: 1.3,
    targetRangePct: [1.2, 3.4],
    stopRangePct: [0.7, 1.9],
    atrTargetMultiple: 0.8,
    atrStopMultiple: 0.45,
    maxHoldDays: 1
  },
  swing: {
    id: "swing",
    label: "Swing",
    window: "5-20 trading days",
    recommendationCount: 10,
    minimumScore: 56,
    minimumRiskReward: 1.35,
    targetRangePct: [4.5, 11.5],
    stopRangePct: [2.4, 5.1],
    atrTargetMultiple: 2.2,
    atrStopMultiple: 1.1,
    maxHoldDays: 7
  },
  position: {
    id: "position",
    label: "Position",
    window: "20-60 trading days",
    recommendationCount: 10,
    minimumScore: 58,
    minimumRiskReward: 1.4,
    targetRangePct: [8.0, 18.0],
    stopRangePct: [4.0, 8.0],
    atrTargetMultiple: 3.6,
    atrStopMultiple: 1.7,
    maxHoldDays: 20
  },
  long_term: {
    id: "long_term",
    label: "Long-term",
    window: "3-12 months",
    recommendationCount: 10,
    minimumScore: 60,
    minimumRiskReward: 1.45,
    targetRangePct: [12.0, 28.0],
    stopRangePct: [6.0, 12.0],
    atrTargetMultiple: 5.4,
    atrStopMultiple: 2.4,
    maxHoldDays: 60
  }
};

const HORIZON_ORDER: HorizonId[] = ["single_day", "swing", "position", "long_term"];

const PROFILE_LIST: HorizonProfile[] = HORIZON_ORDER.map((horizon) => ({
  id: HORIZON_SETTINGS[horizon].id,
  label: HORIZON_SETTINGS[horizon].label,
  window: HORIZON_SETTINGS[horizon].window
}));

const LIVE_DATA_CACHE_MINUTES = (() => {
  const parsed = Number.parseInt(process.env.LIVE_DATA_CACHE_MINUTES ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
})();

let datasetMemoryCache: DatasetCacheEntry | null = null;
let liveDatasetRefreshPromise: Promise<RecommendationDataset | null> | null = null;
let refreshJobStatus: RecommendationRefreshStatus = {
  scope: "all",
  state: "idle",
  phase: "ready",
  detail: "Awaiting manual refresh.",
  percentComplete: 0,
  percentRemaining: 100,
  processedSymbols: 0,
  totalSymbols: MARKET_UNIVERSE.length,
  startedAt: null,
  finishedAt: null,
  generatedAt: null,
  error: null
};

const PROFILE_LOOKUP = new Map(PROFILE_LIST.map((profile) => [profile.id, profile]));

function profileFor(horizon: HorizonId) {
  return PROFILE_LOOKUP.get(horizon) ?? HORIZON_SETTINGS[horizon];
}

function memoryCacheTtlMs() {
  return LIVE_DATA_CACHE_MINUTES * 60 * 1000;
}

function readDatasetMemoryCache() {
  if (!datasetMemoryCache) {
    return null;
  }

  if (Date.now() - datasetMemoryCache.cachedAt > memoryCacheTtlMs()) {
    datasetMemoryCache = null;
    return null;
  }

  return datasetMemoryCache.dataset;
}

function rememberDataset(dataset: RecommendationDataset) {
  datasetMemoryCache = {
    dataset,
    cachedAt: Date.now()
  };

  return dataset;
}

function setRefreshJobStatus(status: Partial<RecommendationRefreshStatus>) {
  const percentComplete = Math.max(
    0,
    Math.min(100, Math.round(status.percentComplete ?? refreshJobStatus.percentComplete))
  );

  refreshJobStatus = {
    ...refreshJobStatus,
    ...status,
    percentComplete,
    percentRemaining: Math.max(0, 100 - percentComplete)
  };
}

function symbolRefreshPercent(processedSymbols: number, totalSymbols: number) {
  if (totalSymbols <= 0) {
    return 8;
  }

  return 8 + (processedSymbols / totalSymbols) * 76;
}

function startRefreshJob(detail: string) {
  refreshJobStatus = {
    scope: "all",
    state: "running",
    phase: "preparing",
    detail,
    percentComplete: 1,
    percentRemaining: 99,
    processedSymbols: 0,
    totalSymbols: MARKET_UNIVERSE.length,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    generatedAt: null,
    error: null
  };
}

function succeedRefreshJob(dataset: RecommendationDataset) {
  setRefreshJobStatus({
    state: "succeeded",
    phase: "complete",
    detail: "Full market dataset refreshed successfully.",
    percentComplete: 100,
    processedSymbols: MARKET_UNIVERSE.length,
    totalSymbols: MARKET_UNIVERSE.length,
    finishedAt: new Date().toISOString(),
    generatedAt: dataset.currentBatch.generatedAt,
    error: null
  });
}

function failRefreshJob(detail: string, error?: string | null) {
  setRefreshJobStatus({
    state: "failed",
    phase: "failed",
    detail,
    finishedAt: new Date().toISOString(),
    error: error ?? null
  });
}

export function getRecommendationRefreshStatus(): RecommendationRefreshStatus {
  return { ...refreshJobStatus };
}

function logDatasetRefreshFailure(error: unknown) {
  console.warn(
    JSON.stringify({
      event: "dataset.refresh",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error)
    })
  );
}

function refreshLiveDatasetInBackground() {
  if (liveDatasetRefreshPromise) {
    return liveDatasetRefreshPromise;
  }

  startRefreshJob("Preparing a full market-data rebuild.");
  liveDatasetRefreshPromise = (async () => {
    try {
      const dataset = await buildLiveDataset();

      if (!dataset) {
        failRefreshJob(
          "Live market refresh did not complete successfully. The previous cached snapshot is still available."
        );
        return null;
      }

      succeedRefreshJob(dataset);
      return dataset;
    } catch (error) {
      logDatasetRefreshFailure(error);
      failRefreshJob(
        "Live market refresh failed. The previous cached snapshot is still available.",
        error instanceof Error ? error.message : String(error)
      );
      return null;
    } finally {
      liveDatasetRefreshPromise = null;
    }
  })();

  return liveDatasetRefreshPromise;
}

export async function refreshRecommendationData() {
  return refreshLiveDatasetInBackground();
}

function horizonMomentumValue(metrics: SnapshotMetrics, horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
      return metrics.sessionChangePct;
    case "swing":
      return metrics.return20;
    case "position":
      return metrics.return60;
    case "long_term":
      return metrics.return120;
  }
}

function horizonMomentumLabel(metrics: SnapshotMetrics, horizon: HorizonId) {
  return percentText(horizonMomentumValue(metrics, horizon));
}

function horizonMomentumSignalName(horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
      return "Session change";
    case "swing":
      return "20D momentum";
    case "position":
      return "60D momentum";
    case "long_term":
      return "120D momentum";
  }
}

function horizonRelativeStrengthValue(metrics: SnapshotMetrics, horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
    case "swing":
      return metrics.relativeStrength20;
    case "position":
      return metrics.relativeStrength60;
    case "long_term":
      return metrics.relativeStrength120;
  }
}

function horizonRelativeStrengthLabel(metrics: SnapshotMetrics, horizon: HorizonId) {
  return percentText(horizonRelativeStrengthValue(metrics, horizon));
}

function horizonRelativeStrengthSignalName(horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
      return "Next-day relative strength";
    case "swing":
      return "20D relative strength";
    case "position":
      return "60D relative strength";
    case "long_term":
      return "120D relative strength";
  }
}

function horizonSummary(entry: MarketSeries, metrics: SnapshotMetrics, horizon: HorizonId) {
  const momentumLabel = horizonMomentumLabel(metrics, horizon);
  const strengthLabel = horizonRelativeStrengthLabel(metrics, horizon);
  const newsTone = entry.sentiment?.overall?.toLowerCase() ?? "neutral";

  switch (horizon) {
    case "single_day":
      return `${metrics.companyName} is shaping up as a next-session tactical idea with ${momentumLabel} session strength, ${strengthLabel} short-term relative strength versus Nifty 50, and a ${newsTone} news tone.`;
    case "swing":
      return `${metrics.companyName} is holding a constructive short-term trend with ${momentumLabel} recent momentum, ${strengthLabel} relative strength versus Nifty 50, and a ${newsTone} news tone.`;
    case "position":
      return `${metrics.companyName} ranks well on the medium-term trend stack, combining ${momentumLabel} price follow-through, ${strengthLabel} benchmark outperformance, and improving fundamental support.`;
    case "long_term":
      return `${metrics.companyName} remains a longer-duration accumulation candidate with ${momentumLabel} multi-month momentum, ${strengthLabel} relative strength versus the index, and supportive fundamental quality markers.`;
  }
}

function horizonBreakoutValue(metrics: SnapshotMetrics, horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
    case "swing":
      return metrics.breakout20Pct;
    case "position":
      return metrics.breakout55Pct;
    case "long_term":
      return metrics.breakout120Pct;
  }
}

function horizonBreakoutWindowLabel(horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
    case "swing":
      return "20-day";
    case "position":
      return "55-day";
    case "long_term":
      return "120-day";
  }
}

function buildTechnicalAnalysisDrivers(metrics: SnapshotMetrics, horizon: HorizonId): AnalysisDriver[] {
  const breakout = horizonBreakoutValue(metrics, horizon);
  const breakoutWindow = horizonBreakoutWindowLabel(horizon);
  let breakoutImpact: AnalysisDriver["impact"] = "neutral";
  let breakoutDetail =
    "The model could not confirm a clean breakout state, so it is leaning more on the broader trend stack than on a fresh trigger level.";

  if (breakout !== null) {
    if (breakout >= 0) {
      breakoutImpact = "positive";
      breakoutDetail = `Price is ${percentText(breakout)} above the recent ${breakoutWindow} high. That matters because a confirmed breakout usually means nearby supply has already been absorbed, which improves follow-through odds.`;
    } else if (breakout >= -1.5) {
      breakoutImpact = "neutral";
      breakoutDetail = `Price is ${percentText(breakout)} below the recent ${breakoutWindow} high. The setup is close to a trigger zone, but it still needs a clean push through resistance before the move becomes more reliable.`;
    } else {
      breakoutImpact = "negative";
      breakoutDetail = `Price is still ${percentText(breakout)} below the recent ${breakoutWindow} high. That keeps the stock under resistance, so upside continuation is less dependable until that ceiling is cleared.`;
    }
  }

  let trendImpact: AnalysisDriver["impact"] = "neutral";
  let trendDetail =
    "The moving-average stack and momentum trend are balanced, so the broader tape is not giving a strong directional push yet.";

  if (metrics.trendClassification === "Bullish") {
    trendImpact = "positive";
    trendDetail = `Trend classification is bullish because price is holding above key moving averages, the 50DMA slope is ${percentText(metrics.sma50Slope10Pct)}, and MACD histogram is ${percentText(metrics.macdHistogramPct)}. That matters because aligned trend and momentum usually keep pullbacks shallower and make breakout follow-through more durable.`;
  } else if (metrics.trendClassification === "Bearish") {
    trendImpact = "negative";
    trendDetail = `Trend classification is bearish because price is lagging key moving averages, the 50DMA slope is ${percentText(metrics.sma50Slope10Pct)}, and MACD histogram is ${percentText(metrics.macdHistogramPct)}. That matters because weak trend alignment makes rallies easier to sell and harder to sustain.`;
  }

  const rsiValue = metrics.rsi14;
  const macdHistogram = metrics.macdHistogramPct;
  const bollingerPosition = metrics.bollingerPositionPct;
  const bollingerBandwidth = metrics.bollingerBandwidthPct;
  let momentumImpact: AnalysisDriver["impact"] = "neutral";
  let momentumDetail =
    "RSI, MACD, and Bollinger-band position are balanced, so momentum is not stretched in either direction.";

  if (
    (rsiValue !== null && rsiValue >= 54 && rsiValue <= 68) &&
    (macdHistogram !== null && macdHistogram > 0) &&
    (bollingerPosition !== null && bollingerPosition >= 55 && bollingerPosition <= 88)
  ) {
    momentumImpact = "positive";
    momentumDetail = `RSI is ${rsiValue !== null ? roundMetric(rsiValue).toFixed(1) : "n/a"}, MACD histogram is ${percentText(macdHistogram)}, and price is sitting at ${bollingerPosition !== null ? `${roundMetric(bollingerPosition).toFixed(1)}%` : "n/a"} of the Bollinger band range with bandwidth ${percentText(bollingerBandwidth)}. That matters because constructive momentum with room left inside the band often supports continuation without forcing the trade into an immediately overbought state.`;
  } else if (
    (rsiValue !== null && rsiValue < 45) ||
    (macdHistogram !== null && macdHistogram < 0) ||
    (bollingerPosition !== null && bollingerPosition < 45)
  ) {
    momentumImpact = "negative";
    momentumDetail = `RSI is ${rsiValue !== null ? roundMetric(rsiValue).toFixed(1) : "n/a"}, MACD histogram is ${percentText(macdHistogram)}, and price is sitting at ${bollingerPosition !== null ? `${roundMetric(bollingerPosition).toFixed(1)}%` : "n/a"} of the Bollinger band range with bandwidth ${percentText(bollingerBandwidth)}. That matters because fading momentum usually shows up before breakouts fail or trends flatten.`;
  }

  const pattern = metrics.candlestickPattern;
  const closeLocation = metrics.closeLocationPct;
  const upperWick = metrics.upperWickPct;
  const candleBody = metrics.candleBodyPct;
  let candleImpact: AnalysisDriver["impact"] = "neutral";
  let candleDetail =
    "The latest candle structure is mixed, so the model is not treating the most recent bar as a decisive confirmation candle.";

  if (pattern === "Bullish engulfing" || pattern === "Bullish marubozu" || pattern === "Hammer") {
    candleImpact = "positive";
    candleDetail = `The latest candle registered a ${pattern.toLowerCase()} with ${closeLocation !== null ? `${roundMetric(closeLocation).toFixed(1)}%` : "n/a"} close location, ${candleBody !== null ? `${roundMetric(candleBody).toFixed(1)}%` : "n/a"} body size, and ${upperWick !== null ? `${roundMetric(upperWick).toFixed(1)}%` : "n/a"} upper wick rejection. That matters because bullish candle patterns often show buyers regaining control near the end of the session.`;
  } else if (
    pattern === "Bearish engulfing" ||
    pattern === "Bearish marubozu" ||
    pattern === "Shooting star"
  ) {
    candleImpact = "negative";
    candleDetail = `The latest candle registered a ${pattern.toLowerCase()} with ${closeLocation !== null ? `${roundMetric(closeLocation).toFixed(1)}%` : "n/a"} close location, ${candleBody !== null ? `${roundMetric(candleBody).toFixed(1)}%` : "n/a"} body size, and ${upperWick !== null ? `${roundMetric(upperWick).toFixed(1)}%` : "n/a"} upper wick rejection. That matters because bearish candle patterns often signal supply stepping in near resistance.`;
  } else if (closeLocation !== null && upperWick !== null && candleBody !== null) {
    candleDetail = `No classic reversal pattern was detected. The latest candle closed at ${roundMetric(closeLocation).toFixed(1)}% of its range with a ${roundMetric(candleBody).toFixed(1)}% real body and ${roundMetric(upperWick).toFixed(1)}% upper wick rejection. That still matters because candle structure shows whether buyers kept control into the close.`;
  }

  const relativeStrength = horizonRelativeStrengthValue(metrics, horizon);
  const volumeRatio = metrics.volumeRatio;
  const volumeTrend = metrics.volumeTrend20Pct;
  let participationImpact: AnalysisDriver["impact"] = "neutral";
  let participationDetail =
    "Participation signals are mixed, so the model is not assuming broad institutional sponsorship behind the current move yet.";

  if (relativeStrength !== null && volumeRatio !== null) {
    if (relativeStrength > 0 && volumeRatio >= 1.05 && (volumeTrend ?? 0) >= 0) {
      participationImpact = "positive";
      participationDetail = `Relative strength versus Nifty 50 is ${percentText(relativeStrength)}, current volume is ${ratioText(volumeRatio)} of the 20-day average, and the recent 20-day average volume trend is ${percentText(volumeTrend)}. That matters because breakouts work best when the stock is already outperforming the benchmark and participation is broadening rather than drying up.`;
    } else if (relativeStrength < 0 || volumeRatio < 0.9 || (volumeTrend ?? 0) < -5) {
      participationImpact = "negative";
      participationDetail = `Relative strength versus Nifty 50 is ${percentText(relativeStrength)}, current volume is only ${ratioText(volumeRatio)} of the 20-day average, and the recent 20-day average volume trend is ${percentText(volumeTrend)}. That matters because weaker participation makes rallies easier to fade and harder to sustain.`;
    } else {
      participationDetail = `Relative strength versus Nifty 50 is ${percentText(relativeStrength)} with current volume at ${ratioText(volumeRatio)} of the 20-day average and a ${percentText(volumeTrend)} 20-day volume trend. That gives the move some support, but not enough to treat it as a high-energy expansion yet.`;
    }
  }

  return [
    { area: "technical", impact: breakoutImpact, title: "Breakout position", detail: breakoutDetail },
    { area: "technical", impact: trendImpact, title: "Trend classification", detail: trendDetail },
    { area: "technical", impact: momentumImpact, title: "Momentum stack", detail: momentumDetail },
    { area: "technical", impact: candleImpact, title: "Candle quality", detail: candleDetail },
    { area: "technical", impact: participationImpact, title: "Participation", detail: participationDetail }
  ];
}

function buildFundamentalAnalysisDrivers(
  entry: MarketSeries,
  sectorContext: FundamentalSectorContext | null = null
): AnalysisDriver[] {
  if (!entry.fundamentals) {
    const sourceState = entry.researchStatus?.fundamentals.state ?? "unavailable";

    return [
      {
        area: "fundamental",
        impact: "neutral",
        title: sourceState === "cached" ? "Cached fundamental snapshot" : "Fundamentals source unavailable",
        detail:
          sourceState === "cached"
            ? "Live fundamentals were unavailable in this batch, so the system reused the most recent cached business-quality snapshot for this stock."
            : "Fundamentals source was unavailable in this batch, so the recommendation is leaning more heavily on chart structure, liquidity, and risk controls than on business-quality data."
      }
    ];
  }

  const growth = entry.fundamentals.salesGrowth5YPct;
  const earningsGrowth = entry.fundamentals.earningsGrowthPct;
  const roe = entry.fundamentals.returnOnEquityPct;
  const roce = entry.fundamentals.returnOnCapitalEmployedPct;
  const debtToEquity = entry.fundamentals.debtToEquity;
  const priceToEarnings = entry.fundamentals.priceToEarnings;
  const priceToBook = entry.fundamentals.priceToBook;
  const promoterHolding = entry.fundamentals.promoterHoldingPct;
  const netMargin = entry.fundamentals.netMarginPct;
  const operatingCashFlow = entry.fundamentals.operatingCashFlowCrore;
  const freeCashFlow = entry.fundamentals.freeCashFlowCrore;

  let qualityImpact: AnalysisDriver["impact"] = "neutral";
  let qualityDetail =
    "Fundamental quality is mixed, so the business backdrop is not strongly amplifying or blocking the technical setup yet.";

  if ((growth ?? 0) >= 12 || (earningsGrowth ?? 0) >= 12 || (roe ?? 0) >= 15 || (roce ?? 0) >= 15) {
    qualityImpact = "positive";
    qualityDetail = `The ${entry.sector.toLowerCase()} business backdrop shows ${growth !== null ? `${roundMetric(growth).toFixed(2)}% five-year sales growth` : "stable sales growth"}, ${earningsGrowth !== null ? `${roundMetric(earningsGrowth).toFixed(2)}% earnings growth` : "steady earnings delivery"}, ${roe !== null ? `${roundMetric(roe).toFixed(2)}% ROE` : "reasonable ROE"}, and ${roce !== null ? `${roundMetric(roce).toFixed(2)}% ROCE` : "acceptable capital efficiency"}. That matters because stronger growth and returns make it easier for a price move to keep compounding instead of rolling over after the first breakout.`;
  } else if (
    (growth !== null && growth < 5) ||
    (earningsGrowth !== null && earningsGrowth < 5) ||
    (roe !== null && roe < 10) ||
    (roce !== null && roce < 10)
  ) {
    qualityImpact = "negative";
    qualityDetail = `The business only shows ${growth !== null ? `${roundMetric(growth).toFixed(2)}% five-year sales growth` : "limited visible growth"}, ${earningsGrowth !== null ? `${roundMetric(earningsGrowth).toFixed(2)}% earnings growth` : "unclear earnings expansion"}, ${roe !== null ? `${roundMetric(roe).toFixed(2)}% ROE` : "unclear ROE"}, and ${roce !== null ? `${roundMetric(roce).toFixed(2)}% ROCE` : "unclear capital efficiency"}. That matters because weak operating quality makes price breakouts easier to fade once short-term momentum cools.`;
  }

  let balanceSheetImpact: AnalysisDriver["impact"] = "neutral";
  let balanceSheetDetail =
    "Leverage and cash-flow markers are balanced, so they are supporting stability without creating a major tailwind or drag yet.";

  if (
    ((debtToEquity !== null && debtToEquity <= 0.6) || promoterHolding !== null || (netMargin ?? 0) >= 10) &&
    (operatingCashFlow === null || operatingCashFlow > 0) &&
    (freeCashFlow === null || freeCashFlow > 0)
  ) {
    balanceSheetImpact = "positive";
    balanceSheetDetail = `Debt to equity is ${debtToEquity !== null ? ratioText(debtToEquity) : "n/a"}, operating cash flow is ${croreText(operatingCashFlow)}, free cash flow is ${croreText(freeCashFlow)}, promoter holding is ${promoterHolding !== null ? `${roundMetric(promoterHolding).toFixed(2)}%` : "n/a"}, and net margin is ${netMargin !== null ? `${roundMetric(netMargin).toFixed(2)}%` : "n/a"}. That matters because lower leverage and positive cash conversion leave more room for the stock to absorb volatility without the market worrying about balance-sheet stress.`;
  } else if (
    (debtToEquity !== null && debtToEquity > 1.2) ||
    (operatingCashFlow !== null && operatingCashFlow < 0) ||
    (freeCashFlow !== null && freeCashFlow < 0) ||
    (netMargin !== null && netMargin < 5)
  ) {
    balanceSheetImpact = "negative";
    balanceSheetDetail = `Debt to equity is ${debtToEquity !== null ? ratioText(debtToEquity) : "n/a"}, operating cash flow is ${croreText(operatingCashFlow)}, free cash flow is ${croreText(freeCashFlow)}, and net margin is ${netMargin !== null ? `${roundMetric(netMargin).toFixed(2)}%` : "n/a"}. That matters because stretched leverage or weak cash conversion can force investors to discount future growth and sell faster when the trade starts working against them.`;
  }

  let sectorImpact: AnalysisDriver["impact"] = "neutral";
  let sectorDetail =
    `Sector context for ${entry.sector} is limited today, so the model is relying more on the stock's standalone valuation and quality markers than on peer-relative positioning.`;

  if (sectorContext && sectorContext.peerCount >= 3) {
    const positiveChecks = [
      roe !== null && sectorContext.medianReturnOnEquityPct !== null && roe > sectorContext.medianReturnOnEquityPct + 1.5,
      roce !== null &&
        sectorContext.medianReturnOnCapitalEmployedPct !== null &&
        roce > sectorContext.medianReturnOnCapitalEmployedPct + 1.5,
      growth !== null && sectorContext.medianSalesGrowth5YPct !== null && growth > sectorContext.medianSalesGrowth5YPct + 2,
      earningsGrowth !== null &&
        sectorContext.medianEarningsGrowthPct !== null &&
        earningsGrowth > sectorContext.medianEarningsGrowthPct + 2,
      debtToEquity !== null &&
        sectorContext.medianDebtToEquity !== null &&
        debtToEquity < sectorContext.medianDebtToEquity - 0.15
    ].filter(Boolean).length;
    const negativeChecks = [
      roe !== null && sectorContext.medianReturnOnEquityPct !== null && roe < sectorContext.medianReturnOnEquityPct - 1.5,
      roce !== null &&
        sectorContext.medianReturnOnCapitalEmployedPct !== null &&
        roce < sectorContext.medianReturnOnCapitalEmployedPct - 1.5,
      growth !== null && sectorContext.medianSalesGrowth5YPct !== null && growth < sectorContext.medianSalesGrowth5YPct - 2,
      earningsGrowth !== null &&
        sectorContext.medianEarningsGrowthPct !== null &&
        earningsGrowth < sectorContext.medianEarningsGrowthPct - 2,
      debtToEquity !== null &&
        sectorContext.medianDebtToEquity !== null &&
        debtToEquity > sectorContext.medianDebtToEquity + 0.15
    ].filter(Boolean).length;

    if (positiveChecks >= 2) {
      sectorImpact = "positive";
      sectorDetail = `${entry.sector} sector peers are acting as the live baseline here. This stock is running ahead of that pack with ROE ${roe !== null ? `${roundMetric(roe).toFixed(2)}%` : "n/a"} versus sector median ${percentText(sectorContext.medianReturnOnEquityPct)}, ROCE ${roce !== null ? `${roundMetric(roce).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianReturnOnCapitalEmployedPct)}, sales growth ${growth !== null ? `${roundMetric(growth).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianSalesGrowth5YPct)}, earnings growth ${earningsGrowth !== null ? `${roundMetric(earningsGrowth).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianEarningsGrowthPct)}, and debt/equity ${debtToEquity !== null ? ratioText(debtToEquity) : "n/a"} versus ${ratioText(sectorContext.medianDebtToEquity)}. That matters because relative leadership inside the same sector usually attracts more durable capital than a move that is only riding market beta.`;
    } else if (negativeChecks >= 2) {
      sectorImpact = "negative";
      sectorDetail = `${entry.sector} sector peers are stronger on average right now. This stock is lagging that peer baseline with ROE ${roe !== null ? `${roundMetric(roe).toFixed(2)}%` : "n/a"} versus sector median ${percentText(sectorContext.medianReturnOnEquityPct)}, ROCE ${roce !== null ? `${roundMetric(roce).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianReturnOnCapitalEmployedPct)}, sales growth ${growth !== null ? `${roundMetric(growth).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianSalesGrowth5YPct)}, earnings growth ${earningsGrowth !== null ? `${roundMetric(earningsGrowth).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianEarningsGrowthPct)}, and debt/equity ${debtToEquity !== null ? ratioText(debtToEquity) : "n/a"} versus ${ratioText(sectorContext.medianDebtToEquity)}. That matters because weaker peer-relative quality makes investors more likely to rotate into stronger names within the same sector.`;
    } else {
      sectorDetail = `${entry.sector} sector peers are the comparison set for this stock. ROE is ${roe !== null ? `${roundMetric(roe).toFixed(2)}%` : "n/a"} versus sector median ${percentText(sectorContext.medianReturnOnEquityPct)}, ROCE is ${roce !== null ? `${roundMetric(roce).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianReturnOnCapitalEmployedPct)}, sales growth is ${growth !== null ? `${roundMetric(growth).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianSalesGrowth5YPct)}, earnings growth is ${earningsGrowth !== null ? `${roundMetric(earningsGrowth).toFixed(2)}%` : "n/a"} versus ${percentText(sectorContext.medianEarningsGrowthPct)}, debt/equity is ${debtToEquity !== null ? ratioText(debtToEquity) : "n/a"} versus ${ratioText(sectorContext.medianDebtToEquity)}, and valuation is ${priceToEarnings !== null ? `${ratioText(priceToEarnings)} P/E` : "n/a P/E"} with ${priceToBook !== null ? `${ratioText(priceToBook)} P/B` : "n/a P/B"}. That matters because stocks are usually repriced against their closest sector substitutes first, not against the entire market.`;
    }
  } else if (priceToEarnings !== null || priceToBook !== null) {
    sectorDetail = `Standalone valuation is ${priceToEarnings !== null ? `${ratioText(priceToEarnings)} P/E` : "n/a P/E"} and ${priceToBook !== null ? `${ratioText(priceToBook)} P/B` : "n/a P/B"} inside the ${entry.sector} space. That matters because valuation decides how much future growth the market has already priced in before the next catalyst arrives.`;
  }

  const drivers: AnalysisDriver[] = [
    { area: "fundamental", impact: qualityImpact, title: "Business quality", detail: qualityDetail },
    {
      area: "fundamental",
      impact: balanceSheetImpact,
      title: "Balance sheet and cash generation",
      detail: balanceSheetDetail
    },
    { area: "fundamental", impact: sectorImpact, title: "Sector positioning", detail: sectorDetail }
  ];

  if (entry.researchStatus?.fundamentals.state === "cached") {
    drivers.push({
      area: "fundamental",
      impact: "neutral",
      title: "Snapshot freshness",
      detail:
        "Live fundamentals were unavailable in this batch, so the system reused the latest cached business-quality snapshot for this stock instead of dropping the lens entirely."
    });
  }

  return drivers;
}

function buildSentimentAnalysisDrivers(entry: MarketSeries): AnalysisDriver[] {
  if (!entry.sentiment) {
    const sourceState = entry.researchStatus?.sentiment.state ?? "unavailable";

    return [
      {
        area: "sentiment",
        impact: "neutral",
        title: sourceState === "cached" ? "Cached headline snapshot" : "Headline sources unavailable",
        detail:
          sourceState === "cached"
            ? "Live headline sources were unavailable in this batch, so the system reused the latest cached tagged headlines for this stock."
            : "Headline sources were unavailable in this batch, so the broad sentiment layer is not materially changing the recommendation in either direction."
      }
    ];
  }

  const sentiment = entry.sentiment;
  const headlineBalance = sentiment.positiveCount - sentiment.negativeCount;
  let toneImpact: AnalysisDriver["impact"] = "neutral";
  let toneDetail =
    "Headline tone is balanced, so sentiment is acting more like background context than like a hard catalyst.";

  if (headlineBalance > 0 && sentiment.score >= 0) {
    toneImpact = "positive";
    toneDetail = `Headline tone is ${sentiment.overall.toLowerCase()} with ${sentiment.positiveCount} positive versus ${sentiment.negativeCount} negative headlines. That matters because positive narrative support makes investors more willing to keep adding on strength.`;
  } else if (headlineBalance < 0 || sentiment.score < 0) {
    toneImpact = "negative";
    toneDetail = `Headline tone is ${sentiment.overall.toLowerCase()} with ${sentiment.positiveCount} positive versus ${sentiment.negativeCount} negative headlines. That matters because a negative narrative can quickly cap upside even when the chart looks constructive.`;
  }

  const coverageCount = sentiment.positiveCount + sentiment.neutralCount + sentiment.negativeCount;
  let coverageImpact: AnalysisDriver["impact"] = "neutral";
  let coverageDetail =
    "Headline coverage is light, so the narrative layer is acting as background context rather than as a strong driver of the move.";

  if (coverageCount >= 5 && headlineBalance > 1) {
    coverageImpact = "positive";
    coverageDetail = `The feed captured ${coverageCount} recent headlines with a clearly positive skew. That matters because heavier supportive coverage tends to keep the stock in focus and can reinforce buying interest after an initial move.`;
  } else if (coverageCount >= 5 && headlineBalance < -1) {
    coverageImpact = "negative";
    coverageDetail = `The feed captured ${coverageCount} recent headlines with a negative skew. That matters because heavier critical coverage can pressure sentiment and make traders quicker to sell strength.`;
  }

  const drivers: AnalysisDriver[] = [
    { area: "sentiment", impact: toneImpact, title: "Narrative tone", detail: toneDetail },
    { area: "sentiment", impact: coverageImpact, title: "Headline coverage", detail: coverageDetail }
  ];

  if (sentiment.announcementCount > 0) {
    drivers.push({
      area: "sentiment",
      impact: "neutral",
      title: "NSE announcements",
      detail: `The sentiment layer includes ${sentiment.announcementCount} tagged NSE announcement headline(s). That matters because exchange-filed updates usually carry more direct stock relevance than general media coverage.`
    });
  }

  if (entry.researchStatus?.sentiment.state === "cached") {
    drivers.push({
      area: "sentiment",
      impact: "neutral",
      title: "Snapshot freshness",
      detail:
        "Live headline sources were unavailable in this batch, so the system reused the latest cached tagged headlines instead of dropping the news layer entirely."
    });
  }

  return drivers;
}

function categoryToneCounts(
  sentiment: MarketSeries["sentiment"],
  category: "earnings" | "analyst"
) {
  const headlines = sentiment?.headlines.filter((headline) => headline.category === category) ?? [];

  return {
    total: headlines.length,
    positive: headlines.filter((headline) => headline.tone === "positive").length,
    negative: headlines.filter((headline) => headline.tone === "negative").length,
    neutral: headlines.filter((headline) => headline.tone === "neutral").length
  };
}

function buildEarningsAnalysisDrivers(entry: MarketSeries, earningsScore: number): AnalysisDriver[] {
  const counts = categoryToneCounts(entry.sentiment ?? null, "earnings");

  if (!entry.sentiment || counts.total === 0) {
    return [
      {
        area: "earnings",
        impact: "neutral",
        title: "Earnings coverage",
        detail:
          entry.researchStatus?.sentiment.state === "unavailable"
            ? "Headline sources were unavailable in this batch, so the earnings lens is not materially lifting or dragging the stock today."
            : "No recent earnings-related headline cluster was found, so the earnings lens is not materially lifting or dragging the stock today."
      }
    ];
  }

  let toneImpact: AnalysisDriver["impact"] = "neutral";
  let toneDetail =
    "Earnings-related headlines are mixed, so the model is treating earnings as context rather than as a decisive catalyst right now.";

  if (earningsScore >= 60 || counts.positive > counts.negative) {
    toneImpact = "positive";
    toneDetail = `The earnings lens scored ${signalScoreText(earningsScore)} because recent earnings-related coverage is supportive (${counts.positive} positive vs ${counts.negative} negative headlines). That matters because constructive results or guidance often keep buyers engaged after the initial move.`;
  } else if (earningsScore <= 45 || counts.negative > counts.positive) {
    toneImpact = "negative";
    toneDetail = `The earnings lens scored ${signalScoreText(earningsScore)} because recent earnings-related coverage is weak (${counts.positive} positive vs ${counts.negative} negative headlines). That matters because disappointing results or cautious guidance can quickly limit upside or trigger de-rating.`;
  }

  let visibilityImpact: AnalysisDriver["impact"] = "neutral";
  let visibilityDetail = `The model found ${counts.total} earnings-related headlines. That is enough to monitor, but not enough on its own to dominate the stock call.`;

  if (counts.total >= 3 && toneImpact === "positive") {
    visibilityImpact = "positive";
    visibilityDetail = `The model found ${counts.total} recent earnings-related headlines. That matters because repeated supportive earnings coverage usually means the market is still digesting the results as a bullish catalyst.`;
  } else if (counts.total >= 3 && toneImpact === "negative") {
    visibilityImpact = "negative";
    visibilityDetail = `The model found ${counts.total} recent earnings-related headlines. That matters because repeated negative earnings coverage can keep pressure on the stock even if the chart tries to stabilize.`;
  }

  return [
    { area: "earnings", impact: toneImpact, title: "Earnings tone", detail: toneDetail },
    { area: "earnings", impact: visibilityImpact, title: "Earnings visibility", detail: visibilityDetail }
  ];
}

function buildAnalystAnalysisDrivers(entry: MarketSeries, analystScore: number): AnalysisDriver[] {
  const counts = categoryToneCounts(entry.sentiment ?? null, "analyst");

  if (!entry.sentiment || counts.total === 0) {
    return [
      {
        area: "analyst",
        impact: "neutral",
        title: "Analyst coverage",
        detail:
          entry.researchStatus?.sentiment.state === "unavailable"
            ? "Headline sources were unavailable in this batch, so the analyst lens is not materially changing the stock score today."
            : "No recent analyst or revision-style headline cluster was found, so the analyst lens is not materially changing the stock score today."
      }
    ];
  }

  let toneImpact: AnalysisDriver["impact"] = "neutral";
  let toneDetail =
    "Analyst coverage is mixed, so the model is not treating broker tone as a decisive source of conviction right now.";

  if (analystScore >= 60 || counts.positive > counts.negative) {
    toneImpact = "positive";
    toneDetail = `The analyst lens scored ${signalScoreText(analystScore)} because revision-style coverage is supportive (${counts.positive} positive vs ${counts.negative} negative headlines). That matters because upgrades and target-price improvements can attract incremental institutional attention.`;
  } else if (analystScore <= 45 || counts.negative > counts.positive) {
    toneImpact = "negative";
    toneDetail = `The analyst lens scored ${signalScoreText(analystScore)} because revision-style coverage is weak (${counts.positive} positive vs ${counts.negative} negative headlines). That matters because downgrades or cautious broker tone often cap rallies and reduce conviction.`;
  }

  let visibilityImpact: AnalysisDriver["impact"] = "neutral";
  let visibilityDetail = `The model found ${counts.total} analyst-related headlines. That gives some context, but it is not a dominant driver by itself.`;

  if (counts.total >= 2 && toneImpact === "positive") {
    visibilityImpact = "positive";
    visibilityDetail = `The model found ${counts.total} analyst-related headlines with supportive tone. That matters because repeated positive broker coverage can reinforce the market narrative behind the stock.`;
  } else if (counts.total >= 2 && toneImpact === "negative") {
    visibilityImpact = "negative";
    visibilityDetail = `The model found ${counts.total} analyst-related headlines with weak tone. That matters because repeated cautious broker commentary can make the market less willing to chase the stock higher.`;
  }

  return [
    { area: "analyst", impact: toneImpact, title: "Analyst tone", detail: toneDetail },
    { area: "analyst", impact: visibilityImpact, title: "Analyst visibility", detail: visibilityDetail }
  ];
}

function buildRiskAnalysisDrivers(
  metrics: SnapshotMetrics,
  horizon: HorizonId,
  riskFeedback: { penalty: number; reasons: string[]; signals: Signal[] },
  entryPrice: number,
  stopLoss: number,
  riskReward: number
): AnalysisDriver[] {
  const stopDistancePct = Math.abs(pctChange(stopLoss, entryPrice) ?? 0);
  const volatility = metrics.volatility20;
  const fragilityImpact: AnalysisDriver["impact"] = riskFeedback.penalty > 0 ? "negative" : "positive";
  const fragilityDetail =
    riskFeedback.penalty > 0 && riskFeedback.reasons.length
      ? `The model removed ${riskFeedback.penalty.toFixed(1)} points for fragility because ${riskFeedback.reasons.join("; ")}. That matters because this engine is designed to reduce exposure to setups that resemble recent stop-loss failures.`
      : "No material recent stop-loss pattern forced a penalty, so the setup is not currently being treated as structurally fragile by the learning layer.";

  let payoffImpact: AnalysisDriver["impact"] = "neutral";
  let payoffDetail = `The plan risks about ${roundMetric(stopDistancePct).toFixed(2)}% to pursue a ${riskReward.toFixed(2)} risk/reward profile. That gives the setup a balanced payoff structure, but it is not unusually asymmetric.`;

  if (riskReward >= 2) {
    payoffImpact = "positive";
    payoffDetail = `The plan risks about ${roundMetric(stopDistancePct).toFixed(2)}% to pursue a ${riskReward.toFixed(2)} risk/reward profile. That matters because the model prefers setups where the potential upside remains meaningfully larger than the planned downside.`;
  } else if (riskReward < 1.4) {
    payoffImpact = "negative";
    payoffDetail = `The plan risks about ${roundMetric(stopDistancePct).toFixed(2)}% to pursue only a ${riskReward.toFixed(2)} risk/reward profile. That matters because thinner payoff asymmetry makes it harder for the setup to absorb normal volatility without disappointing.`;
  }

  const volatilityImpact: AnalysisDriver["impact"] =
    volatility !== null && (horizon === "single_day" || horizon === "swing") && volatility > 3.5
      ? "negative"
      : "neutral";
  const volatilityDetail =
    volatility !== null
      ? volatilityImpact === "negative"
        ? `20-day volatility is ${percentText(volatility)}. That matters because higher short-term volatility increases the chance of a stop-loss being hit before the thesis has time to play out.`
        : `20-day volatility is ${percentText(volatility)}. That gives the trade enough movement to work, without automatically classifying it as an unstable setup.`
      : "Short-term volatility could not be estimated from the available bars, so the risk layer is leaning more on structure and stop-loss learning.";

  return [
    { area: "risk", impact: fragilityImpact, title: "Fragility check", detail: fragilityDetail },
    { area: "risk", impact: payoffImpact, title: "Payoff structure", detail: payoffDetail },
    { area: "risk", impact: volatilityImpact, title: "Volatility pressure", detail: volatilityDetail }
  ];
}

const DATA_DIRECTORY_CANDIDATES = [
  path.join(process.cwd(), "data"),
  path.join(process.cwd(), "..", "..", "data")
];

const SAMPLE_FILE_NAME = "sample-recommendations.json";
const GENERATED_FILE_NAME = "generated-recommendations.json";
const DAILY_BATCH_DIRECTORY_NAME = "daily-batches";
const LIVE_LOOKBACK_RANGE = "1y";
const HISTORY_BATCH_COUNT = 8;
const MINIMUM_LIVE_COVERAGE_RATIO = 0.5;
const LIVE_FETCH_CONCURRENCY = (() => {
  const parsed = Number.parseInt(process.env.LIVE_FETCH_CONCURRENCY ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
})();
const RESEARCH_FETCH_CONCURRENCY = (() => {
  const parsed = Number.parseInt(process.env.RESEARCH_FETCH_CONCURRENCY ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
})();
let activeResearchFetches = 0;
const researchFetchQueue: Array<() => void> = [];

async function withResearchFetchLimit<T>(operation: () => Promise<T>) {
  if (activeResearchFetches >= RESEARCH_FETCH_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      researchFetchQueue.push(resolve);
    });
  }

  activeResearchFetches += 1;

  try {
    return await operation();
  } finally {
    activeResearchFetches = Math.max(0, activeResearchFetches - 1);
    const next = researchFetchQueue.shift();

    if (next) {
      next();
    }
  }
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);

  return ordered.length % 2 === 0
    ? (ordered[midpoint - 1] + ordered[midpoint]) / 2
    : ordered[midpoint];
}

function validNumbers(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
}

function buildSectorFundamentalContextMap(stocks: SectorFundamentalSource[]) {
  const grouped = new Map<string, SectorFundamentalSource[]>();

  for (const stock of stocks) {
    if (!stock.sector) {
      continue;
    }

    const existing = grouped.get(stock.sector) ?? [];
    existing.push(stock);
    grouped.set(stock.sector, existing);
  }

  const contexts = new Map<string, FundamentalSectorContext>();

  for (const [sector, sectorStocks] of grouped) {
    const fundamentals = sectorStocks
      .map((stock) => stock.fundamentals)
      .filter((snapshot): snapshot is NonNullable<StockAnalysis["fundamentals"]> => Boolean(snapshot));

    contexts.set(sector, {
      sector,
      peerCount: fundamentals.length,
      medianPriceToEarnings: median(validNumbers(fundamentals.map((snapshot) => snapshot.priceToEarnings))),
      medianPriceToBook: median(validNumbers(fundamentals.map((snapshot) => snapshot.priceToBook))),
      medianReturnOnEquityPct: median(
        validNumbers(fundamentals.map((snapshot) => snapshot.returnOnEquityPct))
      ),
      medianReturnOnCapitalEmployedPct: median(
        validNumbers(fundamentals.map((snapshot) => snapshot.returnOnCapitalEmployedPct))
      ),
      medianDebtToEquity: median(validNumbers(fundamentals.map((snapshot) => snapshot.debtToEquity))),
      medianSalesGrowth5YPct: median(validNumbers(fundamentals.map((snapshot) => snapshot.salesGrowth5YPct))),
      medianEarningsGrowthPct: median(validNumbers(fundamentals.map((snapshot) => snapshot.earningsGrowthPct)))
    });
  }

  return contexts;
}

function buildCachedResearchMap(dataset: RecommendationDataset | null) {
  const researchMap = new Map<string, CachedResearchSource>();

  for (const stock of dataset?.currentBatch.recommendations ?? []) {
    if (!stock.fundamentals && !stock.sentiment) {
      continue;
    }

    researchMap.set(stock.symbol, {
      fundamentals: stock.fundamentals ?? null,
      sentiment: stock.sentiment ?? null,
      researchStatus: stock.researchStatus
    });
  }

  return researchMap;
}

function collectResearchCoverage(liveSeries: MarketSeries[]): ResearchCoverage {
  return liveSeries.reduce<ResearchCoverage>(
    (coverage, series) => {
      const fundamentalsState = series.researchStatus?.fundamentals.state ?? "unavailable";
      const sentimentState = series.researchStatus?.sentiment.state ?? "unavailable";

      if (fundamentalsState === "live") {
        coverage.fundamentalsLive += 1;
      } else if (fundamentalsState === "cached") {
        coverage.fundamentalsCached += 1;
      } else {
        coverage.fundamentalsUnavailable += 1;
      }

      if (sentimentState === "live") {
        coverage.sentimentLive += 1;
      } else if (sentimentState === "cached") {
        coverage.sentimentCached += 1;
      } else {
        coverage.sentimentUnavailable += 1;
      }

      coverage.nseAnnouncementHeadlines +=
        series.sentiment?.headlines.filter((headline) => headline.source === "NSE Announcements").length ?? 0;
      coverage.googleNewsHeadlines +=
        series.sentiment?.headlines.filter((headline) => headline.source !== "NSE Announcements").length ?? 0;

      return coverage;
    },
    {
      fundamentalsLive: 0,
      fundamentalsCached: 0,
      fundamentalsUnavailable: 0,
      sentimentLive: 0,
      sentimentCached: 0,
      sentimentUnavailable: 0,
      nseAnnouncementHeadlines: 0,
      googleNewsHeadlines: 0
    }
  );
}

function minimumLiveSymbolsRequired() {
  return Math.max(25, Math.floor(MARKET_UNIVERSE.length * MINIMUM_LIVE_COVERAGE_RATIO));
}

function normalizeOverlaySymbol(value: string) {
  return value.trim().toUpperCase().replace(/\.NS$/i, "");
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function pctChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function scaleRange(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value)) {
    return 0.5;
  }

  if (max === min) {
    return 0.5;
  }

  return clamp((value - min) / (max - min), 0, 1);
}

function inverseScale(value: number | null, min: number, max: number) {
  return 1 - scaleRange(value, min, max);
}

function percentText(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${roundMetric(value).toFixed(2)}%`;
}

function ratioText(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${roundMetric(value).toFixed(2)}x`;
}

function priceText(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `Rs ${roundPrice(value).toFixed(2)}`;
}

function compactNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function croreText(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0
  }).format(value)} Cr`;
}

function marketCapBucketFromCrore(value: number | null) {
  if (value === null) {
    return "Large Cap";
  }

  if (value >= 100000) {
    return "Large Cap";
  }

  if (value >= 30000) {
    return "Mid Cap";
  }

  return "Small Cap";
}

function liquidityTierFromVolume(volume: number | null) {
  if (volume === null) {
    return "Tier 2";
  }

  if (volume >= 5000000) {
    return "Tier 1";
  }

  if (volume >= 1000000) {
    return "Tier 2";
  }

  return "Tier 3";
}

function simpleMovingAverage(values: number[], period: number) {
  if (values.length < period) {
    return null;
  }

  return average(values.slice(-period));
}

function annualizedVolatility(closes: number[], period: number) {
  if (closes.length < period + 1) {
    return null;
  }

  const window = closes.slice(-(period + 1));
  const returns = window.slice(1).map((close, index) => (close - window[index]) / window[index]);
  const mean = average(returns);

  if (mean === null) {
    return null;
  }

  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) / returns.length;

  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function relativeStrengthIndex(closes: number[], period: number) {
  if (closes.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  const window = closes.slice(-(period + 1));

  for (let index = 1; index < window.length; index += 1) {
    const change = window[index] - window[index - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;
  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

function averageTrueRange(bars: PriceBar[], period: number) {
  if (bars.length <= period) {
    return null;
  }

  const window = bars.slice(-(period + 1));
  const trueRanges: number[] = [];

  for (let index = 1; index < window.length; index += 1) {
    const current = window[index];
    const previous = window[index - 1];
    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    trueRanges.push(trueRange);
  }

  return average(trueRanges);
}

function rangePosition(current: number, low: number, high: number) {
  if (high <= low) {
    return null;
  }

  return ((current - low) / (high - low)) * 100;
}

function recentExtreme(values: number[], lookback: number, mode: "high" | "low") {
  if (values.length <= lookback) {
    return null;
  }

  const window = values.slice(-(lookback + 1), -1);

  if (!window.length) {
    return null;
  }

  return mode === "high" ? Math.max(...window) : Math.min(...window);
}

function movingAverageSlope(values: number[], period: number, lookback: number) {
  if (values.length < period + lookback) {
    return null;
  }

  const currentAverage = simpleMovingAverage(values, period);
  const priorAverage = simpleMovingAverage(values.slice(0, -lookback), period);

  if (currentAverage === null || priorAverage === null) {
    return null;
  }

  return pctChange(currentAverage, priorAverage);
}

function standardDeviation(values: number[]) {
  if (!values.length) {
    return null;
  }

  const mean = average(values);

  if (mean === null) {
    return null;
  }

  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function exponentialMovingAverageSeries(values: number[], period: number) {
  if (values.length < period) {
    return [];
  }

  const seed = average(values.slice(0, period));

  if (seed === null) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  let ema = seed;
  const series = [ema];

  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
    series.push(ema);
  }

  return series;
}

function macdMetrics(closes: number[]) {
  const ema12Series = exponentialMovingAverageSeries(closes, 12);
  const ema26Series = exponentialMovingAverageSeries(closes, 26);

  if (!ema12Series.length || !ema26Series.length) {
    return {
      line: null,
      signal: null,
      histogram: null
    };
  }

  const offset = Math.max(0, 26 - 12);
  const macdSeries = ema26Series.map((ema26, index) => ema12Series[index + offset] - ema26);
  const signalSeries = exponentialMovingAverageSeries(macdSeries, 9);
  const line = macdSeries.at(-1) ?? null;
  const signal = signalSeries.at(-1) ?? null;

  return {
    line,
    signal,
    histogram: line !== null && signal !== null ? line - signal : null
  };
}

function bollingerMetrics(closes: number[], period = 20, deviationMultiple = 2) {
  if (closes.length < period) {
    return {
      middle: null,
      upper: null,
      lower: null,
      bandwidthPct: null,
      positionPct: null
    };
  }

  const window = closes.slice(-period);
  const middle = average(window);
  const standardDeviationValue = standardDeviation(window);
  const current = window.at(-1) ?? null;

  if (middle === null || standardDeviationValue === null || current === null) {
    return {
      middle: null,
      upper: null,
      lower: null,
      bandwidthPct: null,
      positionPct: null
    };
  }

  const upper = middle + standardDeviationValue * deviationMultiple;
  const lower = middle - standardDeviationValue * deviationMultiple;
  const bandwidthPct = middle !== 0 ? ((upper - lower) / middle) * 100 : null;
  const positionPct = upper > lower ? clamp(((current - lower) / (upper - lower)) * 100, 0, 100) : null;

  return {
    middle,
    upper,
    lower,
    bandwidthPct,
    positionPct
  };
}

function volumeTrendPct(volumes: number[], period = 20) {
  if (volumes.length < period * 2) {
    return null;
  }

  const recentAverage = average(volumes.slice(-period));
  const priorAverage = average(volumes.slice(-(period * 2), -period));

  if (recentAverage === null || priorAverage === null || priorAverage === 0) {
    return null;
  }

  return ((recentAverage - priorAverage) / priorAverage) * 100;
}

function averageBarRangePct(bars: PriceBar[]) {
  const percentages = bars
    .map((bar) => (bar.close !== 0 ? ((bar.high - bar.low) / bar.close) * 100 : null))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return average(percentages);
}

function rangeCompressionRatio(bars: PriceBar[], shortPeriod: number, longPeriod: number) {
  if (bars.length < longPeriod) {
    return null;
  }

  const shortAverage = averageBarRangePct(bars.slice(-shortPeriod));
  const longAverage = averageBarRangePct(bars.slice(-longPeriod));

  if (shortAverage === null || longAverage === null || longAverage === 0) {
    return null;
  }

  return shortAverage / longAverage;
}

function closeLocationPct(bar: PriceBar) {
  const range = bar.high - bar.low;

  if (range <= 0) {
    return null;
  }

  return ((bar.close - bar.low) / range) * 100;
}

function candleBodyPct(bar: PriceBar) {
  const range = bar.high - bar.low;

  if (range <= 0) {
    return null;
  }

  return (Math.abs(bar.close - bar.open) / range) * 100;
}

function upperWickPct(bar: PriceBar) {
  const range = bar.high - bar.low;

  if (range <= 0) {
    return null;
  }

  return ((bar.high - Math.max(bar.open, bar.close)) / range) * 100;
}

function lowerWickPct(bar: PriceBar) {
  const range = bar.high - bar.low;

  if (range <= 0) {
    return null;
  }

  return ((Math.min(bar.open, bar.close) - bar.low) / range) * 100;
}

function detectCandlestickPattern(bar: PriceBar, previous: PriceBar | null) {
  const body = candleBodyPct(bar);
  const closeLocation = closeLocationPct(bar);
  const upperWick = upperWickPct(bar);
  const lowerWick = lowerWickPct(bar);

  if (
    previous &&
    bar.close > bar.open &&
    previous.close < previous.open &&
    bar.open <= previous.close &&
    bar.close >= previous.open
  ) {
    return "Bullish engulfing";
  }

  if (
    previous &&
    bar.close < bar.open &&
    previous.close > previous.open &&
    bar.open >= previous.close &&
    bar.close <= previous.open
  ) {
    return "Bearish engulfing";
  }

  if (lowerWick !== null && body !== null && closeLocation !== null && lowerWick >= 55 && body <= 35 && closeLocation >= 60) {
    return "Hammer";
  }

  if (upperWick !== null && body !== null && closeLocation !== null && upperWick >= 55 && body <= 35 && closeLocation <= 40) {
    return "Shooting star";
  }

  if (
    body !== null &&
    upperWick !== null &&
    lowerWick !== null &&
    bar.close > bar.open &&
    body >= 70 &&
    upperWick <= 10 &&
    lowerWick <= 15
  ) {
    return "Bullish marubozu";
  }

  if (
    body !== null &&
    upperWick !== null &&
    lowerWick !== null &&
    bar.close < bar.open &&
    body >= 70 &&
    upperWick <= 15 &&
    lowerWick <= 10
  ) {
    return "Bearish marubozu";
  }

  return null;
}

function classifyTrend(metrics: SnapshotMetrics): SnapshotMetrics["trendClassification"] {
  const bullishStack =
    metrics.sma50 !== null &&
    metrics.sma200 !== null &&
    metrics.currentPrice > metrics.sma50 &&
    metrics.sma50 > metrics.sma200 &&
    (metrics.sma50Slope10Pct ?? 0) >= 0 &&
    (metrics.macdHistogramPct ?? 0) >= -0.05;
  const bearishStack =
    metrics.sma50 !== null &&
    metrics.sma200 !== null &&
    metrics.currentPrice < metrics.sma50 &&
    metrics.sma50 < metrics.sma200 &&
    (metrics.sma50Slope10Pct ?? 0) <= 0 &&
    (metrics.macdHistogramPct ?? 0) <= 0.05;

  if (bullishStack || ((metrics.relativeStrength20 ?? 0) > 0 && (metrics.macdHistogramPct ?? 0) > 0)) {
    return "Bullish";
  }

  if (bearishStack || ((metrics.relativeStrength20 ?? 0) < 0 && (metrics.macdHistogramPct ?? 0) < 0)) {
    return "Bearish";
  }

  return "Neutral";
}

function tradingDate(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function publishedTimestamp(date: string) {
  return `${date}T15:45:00+05:30`;
}

function signalScoreText(value: number) {
  return `${roundMetric(value).toFixed(1)}/100`;
}

function companyNameFromMeta(meta: ChartMeta, fallbackCompanyName: string) {
  return meta.longName ?? meta.shortName ?? fallbackCompanyName;
}

function convictionFromScore(score: number) {
  if (score >= 74) {
    return "High";
  }

  if (score >= 60) {
    return "Medium";
  }

  return "Low";
}

function meetsRecommendationGate(
  plan: Pick<RecommendationPlan, "score" | "conviction" | "riskReward">,
  settings: Pick<HorizonSettings, "minimumScore" | "minimumRiskReward">
) {
  const score = plan.score ?? 0;
  return score >= settings.minimumScore && plan.conviction !== "Low" && plan.riskReward >= settings.minimumRiskReward;
}

function weightedScore(parts: Array<[number, number]>) {
  const total = parts.reduce((sum, [weight, score]) => sum + weight * score, 0);
  return roundMetric(total * 100);
}

function resolveDataDirectoryFromSample(samplePath: string) {
  return path.dirname(samplePath);
}

async function findFirstReadableFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function readJsonFile<T>(filePath: string) {
  const payload = await readFile(filePath, "utf-8");
  return JSON.parse(payload) as T;
}

function sampleFileCandidates() {
  return DATA_DIRECTORY_CANDIDATES.map((directory) => path.join(directory, SAMPLE_FILE_NAME));
}

async function resolvedDataDirectory() {
  const samplePath = await findFirstReadableFile(sampleFileCandidates());
  const directory = samplePath
    ? resolveDataDirectoryFromSample(samplePath)
    : DATA_DIRECTORY_CANDIDATES[0];

  await mkdir(directory, { recursive: true });

  return directory;
}

async function generatedFilePath() {
  return path.join(await resolvedDataDirectory(), GENERATED_FILE_NAME);
}

async function dailyBatchFilePath(batchDate: string) {
  const directory = path.join(await resolvedDataDirectory(), DAILY_BATCH_DIRECTORY_NAME);
  await mkdir(directory, { recursive: true });

  return path.join(directory, `${batchDate}.json`);
}

function cloneSingleDayPlanFromFallback(plan: RecommendationPlan): RecommendationPlan {
  const settings = HORIZON_SETTINGS.single_day;
  const entryPrice = roundPrice(plan.entryPrice);
  const targetPct = clamp(
    Math.abs(pctChange(plan.targetPrice, plan.entryPrice) ?? plan.expectedReturnPct) * 0.38,
    settings.targetRangePct[0],
    settings.targetRangePct[1]
  );
  const stopPct = clamp(
    Math.abs(pctChange(plan.stopLoss, plan.entryPrice) ?? settings.stopRangePct[0]) * 0.45,
    settings.stopRangePct[0],
    settings.stopRangePct[1]
  );
  const targetPrice = roundPrice(entryPrice * (1 + targetPct / 100));
  const stopLoss = roundPrice(Math.max(entryPrice * (1 - stopPct / 100), entryPrice * 0.85));

  return {
    ...plan,
    score: plan.score ?? 55,
    conviction: plan.conviction === "High" ? "Medium" : plan.conviction,
    entryPrice,
    targetPrice,
    stopLoss,
    expectedReturnPct: roundMetric(pctChange(targetPrice, entryPrice) ?? targetPct),
    riskReward: roundMetric((targetPrice - entryPrice) / Math.max(entryPrice - stopLoss, 0.01)),
    summary: `Fallback single-day setup derived from the saved swing profile. ${plan.summary}`,
    drivers: [
      "This single-day view was synthesized from the saved swing setup because the cached dataset predates the single-day model.",
      ...plan.drivers
    ].slice(0, 4),
    analysisDrivers: [
      {
        area: "risk",
        impact: "neutral",
        title: "Compatibility mode",
        detail:
          "This single-day view was synthesized from the saved swing setup because the cached dataset predates the current single-day reasoning model."
      },
      ...(plan.analysisDrivers ?? [])
    ].slice(0, 6),
    technicalSignals: [
      { name: "Compatibility mode", value: "Derived from swing profile" },
      ...plan.technicalSignals
    ].slice(0, 6),
    riskSignals: plan.riskSignals ?? [
      { name: "Learning status", value: "Awaiting refreshed live batch" }
    ]
  };
}

function cloneSingleDayHistoricalPlanFromFallback(plan: HistoricalRecommendationPlan): HistoricalRecommendationPlan {
  return {
    ...plan,
    conviction: plan.conviction === "High" ? "Medium" : plan.conviction,
    summary: `Fallback single-day history derived from the saved swing result. ${plan.summary}`,
    outcome: {
      ...plan.outcome,
      notes: `This single-day history row reuses the saved swing outcome because the cached dataset predates the single-day model. ${plan.outcome.notes}`
    }
  };
}

function normalizeRecommendationProfiles(profiles: Record<string, RecommendationPlan>) {
  return {
    single_day: profiles.single_day ?? cloneSingleDayPlanFromFallback(profiles.swing),
    swing: profiles.swing,
    position: profiles.position,
    long_term: profiles.long_term
  } satisfies Record<HorizonId, RecommendationPlan>;
}

function normalizeHistoricalProfiles(profiles: Record<string, HistoricalRecommendationPlan>) {
  return {
    single_day: profiles.single_day ?? cloneSingleDayHistoricalPlanFromFallback(profiles.swing),
    swing: profiles.swing,
    position: profiles.position,
    long_term: profiles.long_term
  } satisfies Record<HorizonId, HistoricalRecommendationPlan>;
}

function normalizeDataset(dataset: RecommendationDataset): RecommendationDataset {
  return {
    ...dataset,
    profiles: HORIZON_ORDER.map(
      (horizon) =>
        dataset.profiles.find((profile) => profile.id === horizon) ?? {
          id: horizon,
          label: HORIZON_SETTINGS[horizon].label,
          window: HORIZON_SETTINGS[horizon].window
        }
    ),
    currentBatch: {
      ...dataset.currentBatch,
      recommendations: dataset.currentBatch.recommendations.map((recommendation) => ({
        ...recommendation,
        profiles: normalizeRecommendationProfiles(recommendation.profiles as Record<string, RecommendationPlan>)
      }))
    },
    history: dataset.history.map((batch) => ({
      ...batch,
      recommendations: batch.recommendations.map((recommendation) => ({
        ...recommendation,
        profiles: normalizeHistoricalProfiles(
          recommendation.profiles as Record<string, HistoricalRecommendationPlan>
        )
      }))
    }))
  };
}

async function readSampleDataset() {
  const samplePath = await findFirstReadableFile(sampleFileCandidates());

  if (!samplePath) {
    throw new Error("Unable to locate sample-recommendations.json");
  }

  return normalizeDataset(await readJsonFile<RecommendationDataset>(samplePath));
}

async function readGeneratedDataset() {
  try {
    return normalizeDataset(await readJsonFile<RecommendationDataset>(await generatedFilePath()));
  } catch {
    return null;
  }
}

type DatasetPersistenceResult = {
  latestSnapshot: boolean;
  archivedBatch: boolean;
};

async function writeGeneratedDataset(dataset: RecommendationDataset) {
  const serialized = JSON.stringify(dataset, null, 2);
  let latestSnapshot = false;
  let archivedBatch = false;

  try {
    await writeFile(await generatedFilePath(), serialized, "utf-8");
    latestSnapshot = true;
  } catch {
    latestSnapshot = false;
  }

  try {
    await writeFile(await dailyBatchFilePath(dataset.currentBatch.batchDate), serialized, "utf-8");
    archivedBatch = true;
  } catch {
    archivedBatch = false;
  }

  return {
    latestSnapshot,
    archivedBatch
  } satisfies DatasetPersistenceResult;
}

async function fetchChartPayload(yahooSymbol: string, range = LIVE_LOOKBACK_RANGE) {
  const encodedSymbol = encodeURIComponent(yahooSymbol);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=${range}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=${range}`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (!response.ok) {
        continue;
      }

      return (await response.json()) as YahooChartResponse;
    } catch {
      continue;
    }
  }

  return null;
}

function barsFromPayload(payload: YahooChartResponse) {
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  const opens = quote?.open ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const closes = quote?.close ?? [];
  const volumes = quote?.volume ?? [];
  const bars: PriceBar[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const close = closes[index];
    const volume = volumes[index];

    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    ) {
      continue;
    }

    bars.push({
      date: tradingDate(timestamps[index]),
      timestamp: timestamps[index],
      open,
      high,
      low,
      close,
      volume
    });
  }

  return {
    bars,
    meta: result?.meta ?? {}
  };
}

async function fetchLatestPriceSnapshot(yahooSymbol: string): Promise<LatestPriceSnapshot | null> {
  const payload = await fetchChartPayload(yahooSymbol, PRICE_OVERLAY_RANGE);

  if (!payload) {
    return null;
  }

  const parsed = barsFromPayload(payload);
  const currentBar = parsed.bars.at(-1);

  if (!currentBar) {
    return null;
  }

  const previousBar = parsed.bars.at(-2) ?? null;
  const latestSessionChangePct = previousBar ? pctChange(currentBar.close, previousBar.close) : null;

  return {
    currentMarketPrice: roundPrice(currentBar.close),
    latestSessionChangePct:
      latestSessionChangePct === null ? null : roundMetric(latestSessionChangePct),
    dayStartPrice: roundPrice(currentBar.open),
    asOf: new Date(currentBar.timestamp * 1000).toISOString()
  };
}

export async function fetchLatestPriceOverlay(symbols: string[]) {
  const requestedSymbols = [...new Set(symbols.map(normalizeOverlaySymbol).filter(Boolean))];

  if (!requestedSymbols.length) {
    return {} as Record<string, LatestPriceSnapshot>;
  }

  const universeBySymbol = new Map(MARKET_UNIVERSE.map((entry) => [entry.symbol, entry]));
  const snapshots = await mapWithConcurrency(
    requestedSymbols,
    PRICE_OVERLAY_CONCURRENCY,
    async (symbol) => {
      const knownEntry = universeBySymbol.get(symbol);
      const yahooSymbol = knownEntry?.yahooSymbol ?? (await lookupNseSymbol(symbol))?.yahooSymbol;

      if (!yahooSymbol) {
        return null;
      }

      const snapshot = await fetchLatestPriceSnapshot(yahooSymbol);
      return snapshot ? ([symbol, snapshot] as const) : null;
    }
  );

  return Object.fromEntries(
    snapshots.filter((entry): entry is readonly [string, LatestPriceSnapshot] => entry !== null)
  );
}

async function fetchSeries(entry: UniverseEntry, cachedResearch: CachedResearchSource | null = null) {
  const payload = await fetchChartPayload(entry.yahooSymbol);

  if (!payload) {
    return null;
  }

  const parsed = barsFromPayload(payload);

  if (!parsed.bars.length) {
    return null;
  }

  const research = entry.symbol.startsWith("^")
    ? {
        companyName: companyNameFromMeta(parsed.meta, entry.fallbackCompanyName),
        sector: entry.sector,
        industry: entry.industry,
        fundamentals: null,
        sentiment: null,
        researchStatus: undefined
      }
    : await withResearchFetchLimit(() =>
        fetchCompanyResearch(
          {
            symbol: entry.symbol,
            yahooSymbol: entry.yahooSymbol,
            companyName: companyNameFromMeta(parsed.meta, entry.fallbackCompanyName),
            sector: entry.sector,
            industry: entry.industry
          },
          cachedResearch
        )
      );
  const companyName = research.companyName || companyNameFromMeta(parsed.meta, entry.fallbackCompanyName);

  return {
    ...entry,
    companyName,
    bars: parsed.bars,
    indexByDate: new Map(parsed.bars.map((bar, index) => [bar.date, index])),
    meta: parsed.meta,
    sector: research.sector || entry.sector,
    industry: research.industry ?? entry.industry,
    marketCapBucket: marketCapBucketFromCrore(research.fundamentals?.marketCapCrore ?? null),
    liquidityTier: liquidityTierFromVolume(parsed.meta.regularMarketVolume ?? parsed.bars.at(-1)?.volume ?? null),
    fundamentals: research.fundamentals,
    sentiment: research.sentiment,
    researchStatus: research.researchStatus
  } satisfies MarketSeries;
}

function benchmarkReturn(benchmark: MarketSeries, date: string, lookback: number) {
  const benchmarkIndex = benchmark.indexByDate.get(date);

  if (benchmarkIndex === undefined || benchmarkIndex < lookback) {
    return null;
  }

  return pctChange(
    benchmark.bars[benchmarkIndex].close,
    benchmark.bars[benchmarkIndex - lookback].close
  );
}

function snapshotMetrics(series: MarketSeries, benchmark: MarketSeries, index: number): SnapshotMetrics | null {
  if (index < 200) {
    return null;
  }

  const bars = series.bars.slice(0, index + 1);
  const current = bars.at(-1);

  if (!current) {
    return null;
  }

  const previous = bars.at(-2) ?? null;
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume);
  const sma20 = simpleMovingAverage(closes, 20);
  const sma50 = simpleMovingAverage(closes, 50);
  const sma200 = simpleMovingAverage(closes, 200);
  const sma20Slope5Pct = movingAverageSlope(closes, 20, 5);
  const sma50Slope10Pct = movingAverageSlope(closes, 50, 10);
  const macd = macdMetrics(closes);
  const bollinger = bollingerMetrics(closes);
  const atr14 = averageTrueRange(bars, 14);
  const avgVolume20 = average(volumes.slice(-20));
  const volumeTrend20Pct = volumeTrendPct(volumes, 20);
  const fiftyTwoWeekHigh = Math.max(...highs.slice(-252));
  const fiftyTwoWeekLow = Math.min(...lows.slice(-252));
  const recentHigh20 = recentExtreme(highs, 20, "high");
  const recentHigh55 = recentExtreme(highs, 55, "high");
  const recentHigh120 = recentExtreme(highs, 120, "high");
  const currentCandleCloseLocation = closeLocationPct(current);
  const currentCandleBodyPct = candleBodyPct(current);
  const currentUpperWickPct = upperWickPct(current);
  const currentLowerWickPct = lowerWickPct(current);
  const candlestickPattern = detectCandlestickPattern(current, previous);

  return {
    date: current.date,
    companyName: series.companyName,
    currentPrice: current.close,
    previousClose: previous?.close ?? null,
    sessionChangePct: previous ? pctChange(current.close, previous.close) : null,
    openingGapPct: previous ? pctChange(current.open, previous.close) : null,
    closeLocationPct: currentCandleCloseLocation,
    candleBodyPct: currentCandleBodyPct,
    upperWickPct: currentUpperWickPct,
    lowerWickPct: currentLowerWickPct,
    sma20,
    sma50,
    sma200,
    sma20Slope5Pct,
    sma50Slope10Pct,
    rsi14: relativeStrengthIndex(closes, 14),
    macdLinePct: macd.line !== null ? ((macd.line / current.close) * 100) : null,
    macdSignalPct: macd.signal !== null ? ((macd.signal / current.close) * 100) : null,
    macdHistogramPct: macd.histogram !== null ? ((macd.histogram / current.close) * 100) : null,
    atr14,
    atrPct: atr14 ? pctChange(current.close + atr14, current.close) : null,
    return20: closes.length > 20 ? pctChange(current.close, closes[closes.length - 21]) : null,
    return60: closes.length > 60 ? pctChange(current.close, closes[closes.length - 61]) : null,
    return120: closes.length > 120 ? pctChange(current.close, closes[closes.length - 121]) : null,
    breakout20Pct: recentHigh20 !== null ? pctChange(current.close, recentHigh20) : null,
    breakout55Pct: recentHigh55 !== null ? pctChange(current.close, recentHigh55) : null,
    breakout120Pct: recentHigh120 !== null ? pctChange(current.close, recentHigh120) : null,
    rangeCompression5v20: rangeCompressionRatio(bars, 5, 20),
    benchmarkReturn20: benchmarkReturn(benchmark, current.date, 20),
    benchmarkReturn60: benchmarkReturn(benchmark, current.date, 60),
    benchmarkReturn120: benchmarkReturn(benchmark, current.date, 120),
    relativeStrength20: null,
    relativeStrength60: null,
    relativeStrength120: null,
    volatility20: annualizedVolatility(closes, 20),
    avgVolume20,
    volumeRatio: avgVolume20 ? current.volume / avgVolume20 : null,
    volumeTrend20Pct,
    rangePosition: rangePosition(current.close, fiftyTwoWeekLow, fiftyTwoWeekHigh),
    bollingerPositionPct: bollinger.positionPct,
    bollingerBandwidthPct: bollinger.bandwidthPct,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    distanceFromHighPct: pctChange(current.close, fiftyTwoWeekHigh),
    distanceFromLowPct: fiftyTwoWeekLow ? pctChange(current.close, fiftyTwoWeekLow) : null,
    benchmarkSessionChangePct: (() => {
      const benchmarkIndex = benchmark.indexByDate.get(current.date);

      if (benchmarkIndex === undefined || benchmarkIndex === 0) {
        return null;
      }

      return pctChange(
        benchmark.bars[benchmarkIndex].close,
        benchmark.bars[benchmarkIndex - 1].close
      );
    })(),
    currentVolume: current.volume,
    candlestickPattern,
    trendClassification: "Neutral"
  };
}

function enrichRelativeStrength(metrics: SnapshotMetrics): SnapshotMetrics {
  const enriched = {
    ...metrics,
    relativeStrength20:
      metrics.return20 !== null && metrics.benchmarkReturn20 !== null
        ? metrics.return20 - metrics.benchmarkReturn20
        : null,
    relativeStrength60:
      metrics.return60 !== null && metrics.benchmarkReturn60 !== null
        ? metrics.return60 - metrics.benchmarkReturn60
        : null,
    relativeStrength120:
      metrics.return120 !== null && metrics.benchmarkReturn120 !== null
        ? metrics.return120 - metrics.benchmarkReturn120
        : null
  };

  return {
    ...enriched,
    trendClassification: classifyTrend(enriched)
  };
}

function normalizeRsi(rsi: number | null) {
  if (rsi === null) {
    return 0.5;
  }

  return 1 - clamp(Math.abs(rsi - 56) / 24, 0, 1);
}

function macdSignalScore(macdHistogramPct: number | null) {
  return scaleRange(macdHistogramPct, -0.6, 0.6);
}

function trendClassificationScore(trendClassification: SnapshotMetrics["trendClassification"]) {
  switch (trendClassification) {
    case "Bullish":
      return 1;
    case "Bearish":
      return 0;
    default:
      return 0.5;
  }
}

function candlestickPatternScore(pattern: string | null) {
  switch (pattern) {
    case "Bullish engulfing":
    case "Bullish marubozu":
    case "Hammer":
      return 1;
    case "Bearish engulfing":
    case "Bearish marubozu":
    case "Shooting star":
      return 0;
    default:
      return 0.5;
  }
}

function liquidityScore(liquidityTier: string) {
  return liquidityTier === "Tier 1" ? 1 : 0.7;
}

function marketCapScore(marketCapBucket: string) {
  return marketCapBucket === "Large Cap" ? 1 : 0.75;
}

function scoreForHorizon(metrics: SnapshotMetrics, entry: UniverseEntry, horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
      return weightedScore([
        [0.2, scaleRange(metrics.sessionChangePct, -2.8, 4.8)],
        [0.18, scaleRange(metrics.relativeStrength20, -5, 8)],
        [0.14, scaleRange(metrics.volumeRatio, 0.8, 2.2)],
        [0.08, scaleRange(metrics.volumeTrend20Pct, -18, 28)],
        [0.1, metrics.sma20 && metrics.currentPrice > metrics.sma20 ? 1 : 0],
        [0.08, metrics.previousClose && metrics.currentPrice > metrics.previousClose ? 1 : 0],
        [0.08, normalizeRsi(metrics.rsi14)],
        [0.08, macdSignalScore(metrics.macdHistogramPct)],
        [0.06, scaleRange(metrics.bollingerPositionPct, 35, 100)]
      ]);
    case "swing":
      return weightedScore([
        [0.2, scaleRange(metrics.return20, -8, 16)],
        [0.16, scaleRange(metrics.relativeStrength20, -6, 10)],
        [0.11, metrics.sma20 && metrics.currentPrice > metrics.sma20 ? 1 : 0],
        [0.1, metrics.sma50 && metrics.currentPrice > metrics.sma50 ? 1 : 0],
        [0.1, metrics.sma20 && metrics.sma50 && metrics.sma20 > metrics.sma50 ? 1 : 0],
        [0.08, normalizeRsi(metrics.rsi14)],
        [0.08, scaleRange(metrics.volumeRatio, 0.75, 1.8)],
        [0.06, scaleRange(metrics.volumeTrend20Pct, -18, 26)],
        [0.06, macdSignalScore(metrics.macdHistogramPct)],
        [0.05, scaleRange(metrics.bollingerPositionPct, 35, 100)]
      ]);
    case "position":
      return weightedScore([
        [0.2, scaleRange(metrics.return60, -12, 22)],
        [0.16, scaleRange(metrics.relativeStrength60, -8, 14)],
        [0.12, metrics.sma50 && metrics.currentPrice > metrics.sma50 ? 1 : 0],
        [0.12, metrics.sma200 && metrics.currentPrice > metrics.sma200 ? 1 : 0],
        [0.11, metrics.sma50 && metrics.sma200 && metrics.sma50 > metrics.sma200 ? 1 : 0],
        [0.08, scaleRange(metrics.rangePosition, 30, 95)],
        [0.07, inverseScale(metrics.volatility20, 18, 48)],
        [0.05, scaleRange(metrics.volumeTrend20Pct, -15, 22)],
        [0.05, macdSignalScore(metrics.macdHistogramPct)],
        [0.04, trendClassificationScore(metrics.trendClassification)]
      ]);
    case "long_term":
      return weightedScore([
        [0.22, scaleRange(metrics.return120, -15, 30)],
        [0.16, scaleRange(metrics.relativeStrength120, -10, 18)],
        [0.15, metrics.sma200 && metrics.currentPrice > metrics.sma200 ? 1 : 0],
        [0.1, scaleRange(metrics.rangePosition, 28, 95)],
        [0.08, scaleRange(metrics.distanceFromHighPct, -35, 0)],
        [0.08, inverseScale(metrics.volatility20, 16, 45)],
        [0.07, marketCapScore(entry.marketCapBucket)],
        [0.05, liquidityScore(entry.liquidityTier)],
        [0.05, macdSignalScore(metrics.macdHistogramPct)],
        [0.04, trendClassificationScore(metrics.trendClassification)]
      ]);
  }
}

function chartAnalysisScore(metrics: SnapshotMetrics, horizon: HorizonId) {
  switch (horizon) {
    case "single_day":
      return weightedScore([
        [0.19, scaleRange(metrics.breakout20Pct, -1.8, 2.5)],
        [0.14, scaleRange(metrics.closeLocationPct, 35, 100)],
        [0.12, scaleRange(metrics.candleBodyPct, 18, 100)],
        [0.1, inverseScale(metrics.upperWickPct, 18, 70)],
        [0.08, scaleRange(metrics.openingGapPct, -0.8, 1.5)],
        [0.08, scaleRange(metrics.sma20Slope5Pct, -1.2, 2.8)],
        [0.08, inverseScale(metrics.rangeCompression5v20, 0.55, 1.35)],
        [0.11, candlestickPatternScore(metrics.candlestickPattern)],
        [0.1, scaleRange(metrics.bollingerPositionPct, 38, 100)]
      ]);
    case "swing":
      return weightedScore([
        [0.21, scaleRange(metrics.breakout20Pct, -3, 5.5)],
        [0.16, scaleRange(metrics.breakout55Pct, -5, 8)],
        [0.13, scaleRange(metrics.closeLocationPct, 38, 100)],
        [0.1, scaleRange(metrics.candleBodyPct, 18, 95)],
        [0.08, inverseScale(metrics.upperWickPct, 18, 68)],
        [0.08, scaleRange(metrics.sma20Slope5Pct, -1.5, 4)],
        [0.08, inverseScale(metrics.rangeCompression5v20, 0.55, 1.25)],
        [0.08, scaleRange(metrics.bollingerPositionPct, 38, 100)],
        [0.08, inverseScale(metrics.bollingerBandwidthPct, 4, 18)],
        [0.1, candlestickPatternScore(metrics.candlestickPattern)]
      ]);
    case "position":
      return weightedScore([
        [0.22, scaleRange(metrics.breakout55Pct, -6, 10)],
        [0.15, scaleRange(metrics.breakout120Pct, -8, 12)],
        [0.12, scaleRange(metrics.closeLocationPct, 40, 100)],
        [0.12, scaleRange(metrics.sma50Slope10Pct, -2.5, 6)],
        [0.08, inverseScale(metrics.upperWickPct, 18, 65)],
        [0.08, scaleRange(metrics.lowerWickPct, 10, 55)],
        [0.07, inverseScale(metrics.rangeCompression5v20, 0.55, 1.2)],
        [0.06, scaleRange(metrics.bollingerPositionPct, 40, 100)],
        [0.05, inverseScale(metrics.bollingerBandwidthPct, 4, 18)],
        [0.05, candlestickPatternScore(metrics.candlestickPattern)]
      ]);
    case "long_term":
      return weightedScore([
        [0.25, scaleRange(metrics.breakout120Pct, -10, 16)],
        [0.17, scaleRange(metrics.sma50Slope10Pct, -2.5, 7)],
        [0.14, scaleRange(metrics.rangePosition, 45, 98)],
        [0.1, scaleRange(metrics.closeLocationPct, 42, 100)],
        [0.08, inverseScale(metrics.upperWickPct, 18, 62)],
        [0.07, scaleRange(metrics.lowerWickPct, 10, 55)],
        [0.06, inverseScale(metrics.rangeCompression5v20, 0.55, 1.2)],
        [0.05, scaleRange(metrics.bollingerPositionPct, 42, 100)],
        [0.04, inverseScale(metrics.bollingerBandwidthPct, 4, 18)],
        [0.04, candlestickPatternScore(metrics.candlestickPattern)]
      ]);
  }
}

function technicalScoreBreakdown(metrics: SnapshotMetrics, entry: UniverseEntry, horizon: HorizonId) {
  const factorScore = scoreForHorizon(metrics, entry, horizon);
  const chartScore = chartAnalysisScore(metrics, horizon);

  switch (horizon) {
    case "single_day":
      return {
        factorScore,
        chartScore,
        technicalScore: roundMetric(factorScore * 0.58 + chartScore * 0.42)
      };
    case "swing":
      return {
        factorScore,
        chartScore,
        technicalScore: roundMetric(factorScore * 0.64 + chartScore * 0.36)
      };
    case "position":
      return {
        factorScore,
        chartScore,
        technicalScore: roundMetric(factorScore * 0.7 + chartScore * 0.3)
      };
    case "long_term":
      return {
        factorScore,
        chartScore,
        technicalScore: roundMetric(factorScore * 0.76 + chartScore * 0.24)
      };
  }
}

function blendedModelScore(
  entry: MarketSeries,
  metrics: SnapshotMetrics,
  horizon: HorizonId,
  precomputedTechnicalScore?: number,
  sectorContext: FundamentalSectorContext | null = null
) {
  const technicalScore =
    precomputedTechnicalScore ?? technicalScoreBreakdown(metrics, entry, horizon).technicalScore;
  const fundamentalScore = scoreFundamentals(entry.fundamentals ?? null, sectorContext);
  const sentimentScore = scoreSentiment(entry.sentiment ?? null);
  const earningsScore = scoreEarningsSignal(entry.sentiment ?? null);
  const analystScore = scoreAnalystSignal(entry.sentiment ?? null);

  switch (horizon) {
    case "single_day":
      return roundMetric(
        technicalScore * 0.8 +
          fundamentalScore * 0.04 +
          sentimentScore * 0.08 +
          earningsScore * 0.04 +
          analystScore * 0.04
      );
    case "swing":
      return roundMetric(
        technicalScore * 0.72 +
          fundamentalScore * 0.08 +
          sentimentScore * 0.1 +
          earningsScore * 0.05 +
          analystScore * 0.05
      );
    case "position":
      return roundMetric(
        technicalScore * 0.6 +
          fundamentalScore * 0.18 +
          sentimentScore * 0.1 +
          earningsScore * 0.06 +
          analystScore * 0.06
      );
    case "long_term":
      return roundMetric(
        technicalScore * 0.52 +
          fundamentalScore * 0.24 +
          sentimentScore * 0.08 +
          earningsScore * 0.08 +
          analystScore * 0.08
      );
  }
}

function projectedPct(score: number, [minPct, maxPct]: [number, number]) {
  const normalizedScore = scaleRange(score, 45, 85);
  return minPct + (maxPct - minPct) * normalizedScore;
}

function stopLossFragilityFeedback(
  metrics: SnapshotMetrics,
  horizon: HorizonId,
  learning: StopLossLearning | null
) {
  let fragilityPenalty = 0;
  const reasons: string[] = [];
  const signals: Signal[] = [];

  if ((metrics.volumeRatio ?? 1) < 0.95) {
    fragilityPenalty += horizon === "single_day" ? 1.8 : 1.2;
    reasons.push("volume confirmation is weak");
    signals.push({ name: "Volume confirmation", value: ratioText(metrics.volumeRatio) });
  }

  if ((metrics.volatility20 ?? 0) > (horizon === "single_day" ? 30 : horizon === "swing" ? 38 : 44)) {
    fragilityPenalty += horizon === "single_day" ? 2.2 : 1.6;
    reasons.push("volatility is elevated");
    signals.push({ name: "20D volatility", value: percentText(metrics.volatility20) });
  }

  if ((metrics.rsi14 ?? 50) > 72) {
    fragilityPenalty += 1.4;
    reasons.push("RSI is stretched");
    signals.push({
      name: "RSI stretch",
      value: metrics.rsi14 !== null ? roundMetric(metrics.rsi14).toFixed(1) : "n/a"
    });
  }

  if ((horizon === "single_day" || horizon === "swing") && metrics.sma20 && metrics.currentPrice < metrics.sma20) {
    fragilityPenalty += 1.8;
    reasons.push("price is below 20DMA support");
    signals.push({
      name: "Price vs 20DMA",
      value: percentText(pctChange(metrics.currentPrice, metrics.sma20))
    });
  }

  if ((metrics.relativeStrength20 ?? 0) < 0) {
    fragilityPenalty += horizon === "single_day" ? 1.8 : 1.2;
    reasons.push("short-term relative strength is negative");
    signals.push({
      name: "Short-term relative strength",
      value: percentText(metrics.relativeStrength20)
    });
  }

  if ((metrics.upperWickPct ?? 0) > 45) {
    fragilityPenalty += horizon === "single_day" ? 1.8 : 1.2;
    reasons.push("the latest candle was rejected near resistance");
    signals.push({
      name: "Upper wick",
      value: metrics.upperWickPct !== null ? `${roundMetric(metrics.upperWickPct).toFixed(1)}%` : "n/a"
    });
  }

  if ((metrics.closeLocationPct ?? 50) < 42) {
    fragilityPenalty += 1.4;
    reasons.push("the latest close finished in the lower half of the range");
    signals.push({
      name: "Close location",
      value: metrics.closeLocationPct !== null ? `${roundMetric(metrics.closeLocationPct).toFixed(1)}%` : "n/a"
    });
  }

  if ((horizon === "single_day" || horizon === "swing") && (metrics.breakout20Pct ?? 0) < 0) {
    fragilityPenalty += 1.6;
    reasons.push("price is still below recent resistance");
    signals.push({ name: "20D breakout", value: percentText(metrics.breakout20Pct) });
  }

  if ((horizon === "position" || horizon === "long_term") && (metrics.sma50Slope10Pct ?? 0) < 0) {
    fragilityPenalty += 1.5;
    reasons.push("trend slope is flattening");
    signals.push({ name: "50DMA slope", value: percentText(metrics.sma50Slope10Pct) });
  }

  if ((horizon === "position" || horizon === "long_term") && metrics.trendClassification === "Bearish") {
    fragilityPenalty += 2;
    reasons.push("the broader trend stack is bearish");
    signals.push({ name: "Trend classification", value: metrics.trendClassification });
  }

  if ((metrics.macdHistogramPct ?? 0) < 0) {
    fragilityPenalty += horizon === "single_day" ? 1.2 : 0.8;
    reasons.push("MACD momentum is fading");
    signals.push({ name: "MACD histogram", value: percentText(metrics.macdHistogramPct) });
  }

  if ((metrics.bollingerPositionPct ?? 50) > 95 && (metrics.closeLocationPct ?? 50) < 55) {
    fragilityPenalty += 1.2;
    reasons.push("price is stretched near the top Bollinger band without a strong close");
    signals.push({ name: "Bollinger position", value: percentText(metrics.bollingerPositionPct) });
  }

  if (horizon === "single_day" && (metrics.sessionChangePct ?? 0) < 0) {
    fragilityPenalty += 1.8;
    reasons.push("the latest session faded into the close");
    signals.push({ name: "Latest session", value: percentText(metrics.sessionChangePct) });
  }

  const learningPenalty = learning?.penalty ?? 0;
  const totalPenalty = roundMetric(clamp(fragilityPenalty + learningPenalty, 0, 15));
  const learningNote =
    learning?.note ??
    (learningPenalty
      ? `Recent ${profileFor(horizon).label.toLowerCase()} stop-loss history increases caution.`
      : null);

  return {
    penalty: totalPenalty,
    reasons: learningNote ? [...reasons, learningNote] : reasons,
    signals: [
      { name: "Fragility penalty", value: `${roundMetric(fragilityPenalty).toFixed(1)} pts` },
      { name: "Learning penalty", value: `${roundMetric(learningPenalty).toFixed(1)} pts` },
      ...(learning
        ? [
            { name: "Recent stop-losses", value: `${learning.recentStopLosses}` },
            { name: "Quick stop-losses", value: `${learning.quickStopLosses}` }
          ]
        : []),
      ...signals
    ].slice(0, 6)
  };
}

function buildTradePlan(
  metrics: SnapshotMetrics,
  entry: MarketSeries,
  horizon: HorizonId,
  learning: StopLossLearning | null = null,
  sectorContext: FundamentalSectorContext | null = null
): PlanTemplate {
  const settings = HORIZON_SETTINGS[horizon];
  const technicalBreakdown = technicalScoreBreakdown(metrics, entry, horizon);
  const rawScore = blendedModelScore(entry, metrics, horizon, technicalBreakdown.technicalScore, sectorContext);
  const technicalScore = technicalBreakdown.technicalScore;
  const chartScore = technicalBreakdown.chartScore;
  const factorScore = technicalBreakdown.factorScore;
  const fundamentalScore = scoreFundamentals(entry.fundamentals ?? null, sectorContext);
  const sentimentScore = scoreSentiment(entry.sentiment ?? null);
  const earningsScore = scoreEarningsSignal(entry.sentiment ?? null);
  const analystScore = scoreAnalystSignal(entry.sentiment ?? null);
  const riskFeedback = stopLossFragilityFeedback(metrics, horizon, learning);
  const score = roundMetric(clamp(rawScore - riskFeedback.penalty, 0, 100));
  const atrPct = metrics.atrPct ?? (settings.targetRangePct[0] * 0.45);
  const entryPrice = roundPrice(metrics.currentPrice);
  const targetPct = Math.max(
    projectedPct(score, settings.targetRangePct),
    atrPct * settings.atrTargetMultiple
  );
  const stopPct = Math.max(
    projectedPct(100 - score, settings.stopRangePct),
    atrPct * settings.atrStopMultiple
  );
  const targetPrice = roundPrice(entryPrice * (1 + targetPct / 100));
  const stopLoss = roundPrice(Math.max(entryPrice * (1 - stopPct / 100), entryPrice * 0.7));
  const expectedReturnPct = pctChange(targetPrice, entryPrice) ?? 0;
  const riskReward = roundMetric((targetPrice - entryPrice) / Math.max(entryPrice - stopLoss, 0.01));
  const conviction = convictionFromScore(score);
  const strengthLabel = horizonRelativeStrengthLabel(metrics, horizon);
  const returnLabel = horizonMomentumLabel(metrics, horizon);
  const summaryBase = horizonSummary(entry, metrics, horizon);
  const summary =
    riskFeedback.reasons.length && riskFeedback.penalty > 0
      ? `${summaryBase} Risk controls trimmed the setup because ${riskFeedback.reasons[0]}.`
      : summaryBase;
  const chartLabel =
    (horizon === "single_day" || horizon === "swing") && (metrics.breakout20Pct ?? -1) >= 0
      ? `price is trading ${percentText(metrics.breakout20Pct)} versus the recent 20-day high`
      : horizon === "position" && (metrics.breakout55Pct ?? -1) >= 0
        ? `price is trading ${percentText(metrics.breakout55Pct)} versus the recent 55-day high`
        : horizon === "long_term" && (metrics.breakout120Pct ?? -1) >= 0
          ? `price is trading ${percentText(metrics.breakout120Pct)} versus the recent 120-day high`
          : `price has not cleanly cleared the recent breakout zone yet`;

  const analysisDrivers = [
    ...buildTechnicalAnalysisDrivers(metrics, horizon),
    ...buildFundamentalAnalysisDrivers(entry, sectorContext),
    ...buildSentimentAnalysisDrivers(entry),
    ...buildEarningsAnalysisDrivers(entry, earningsScore),
    ...buildAnalystAnalysisDrivers(entry, analystScore),
    ...buildRiskAnalysisDrivers(metrics, horizon, riskFeedback, entryPrice, stopLoss, riskReward)
  ];
  const drivers = analysisDrivers.map((driver) => `${driver.title}: ${driver.detail}`).slice(0, 8);

  const technicalSignals: Signal[] = [
    { name: "Adjusted score", value: signalScoreText(score) },
    { name: "Technical score", value: signalScoreText(technicalScore) },
    { name: "Trend classification", value: metrics.trendClassification },
    {
      name: "RSI (14)",
      value: metrics.rsi14 !== null ? roundMetric(metrics.rsi14).toFixed(1) : "n/a"
    },
    { name: "MACD histogram", value: percentText(metrics.macdHistogramPct) },
    {
      name: "Bollinger position",
      value:
        metrics.bollingerPositionPct !== null
          ? `${roundMetric(metrics.bollingerPositionPct).toFixed(1)}%`
          : "n/a"
    },
    {
      name: horizonMomentumSignalName(horizon),
      value: returnLabel
    },
    {
      name: horizonRelativeStrengthSignalName(horizon),
      value: strengthLabel
    },
    {
      name: "Price vs 50DMA",
      value: metrics.sma50 ? percentText(pctChange(metrics.currentPrice, metrics.sma50)) : "n/a"
    },
    {
      name: "Price vs 200DMA",
      value: metrics.sma200 ? percentText(pctChange(metrics.currentPrice, metrics.sma200)) : "n/a"
    },
    {
      name: "Volume vs 20D average",
      value: ratioText(metrics.volumeRatio)
    },
    {
      name: "20D volume trend",
      value: percentText(metrics.volumeTrend20Pct)
    },
    { name: "Raw blended score", value: signalScoreText(rawScore) },
    { name: "Factor trend score", value: signalScoreText(factorScore) },
    { name: "Chart structure score", value: signalScoreText(chartScore) },
    {
      name: "Candle close location",
      value: metrics.closeLocationPct !== null ? `${roundMetric(metrics.closeLocationPct).toFixed(1)}%` : "n/a"
    },
    {
      name: "Candle body strength",
      value: metrics.candleBodyPct !== null ? `${roundMetric(metrics.candleBodyPct).toFixed(1)}%` : "n/a"
    },
    {
      name: "Candlestick pattern",
      value: metrics.candlestickPattern ?? "No major pattern"
    },
    {
      name:
        horizon === "single_day"
          ? "20D breakout"
          : horizon === "swing"
            ? "20D breakout"
            : horizon === "position"
              ? "55D breakout"
              : "120D breakout",
      value:
        horizon === "single_day" || horizon === "swing"
          ? percentText(metrics.breakout20Pct)
          : horizon === "position"
            ? percentText(metrics.breakout55Pct)
            : percentText(metrics.breakout120Pct)
    },
    {
      name: "Range compression (5D/20D)",
      value: metrics.rangeCompression5v20 !== null ? `${roundMetric(metrics.rangeCompression5v20).toFixed(2)}x` : "n/a"
    },
    {
      name: "Bollinger bandwidth",
      value: percentText(metrics.bollingerBandwidthPct)
    }
  ];

  const fundamentalSignals: Signal[] = entry.fundamentals
    ? [
        { name: "Sector", value: entry.sector },
        { name: "Industry", value: entry.industry ?? entry.sector },
        {
          name: "Fundamentals source",
          value:
            entry.researchStatus?.fundamentals.state === "cached"
              ? "Cached snapshot"
              : entry.researchStatus?.fundamentals.state === "live"
                ? "Live source"
                : "Unavailable"
        },
        { name: "Fundamental score", value: signalScoreText(fundamentalScore) },
        { name: "Market cap", value: croreText(entry.fundamentals.marketCapCrore) },
        { name: "P/E", value: ratioText(entry.fundamentals.priceToEarnings) },
        { name: "P/B", value: ratioText(entry.fundamentals.priceToBook) },
        {
          name: "ROE",
          value:
            entry.fundamentals.returnOnEquityPct !== null
              ? `${roundMetric(entry.fundamentals.returnOnEquityPct).toFixed(2)}%`
              : "n/a"
        },
        {
          name: "ROCE",
          value:
            entry.fundamentals.returnOnCapitalEmployedPct !== null
              ? `${roundMetric(entry.fundamentals.returnOnCapitalEmployedPct).toFixed(2)}%`
              : "n/a"
        },
        {
          name: "Debt / Equity",
          value:
            entry.fundamentals.debtToEquity !== null
              ? ratioText(entry.fundamentals.debtToEquity)
              : "n/a"
        },
        {
          name: "5Y sales growth",
          value:
            entry.fundamentals.salesGrowth5YPct !== null
              ? `${roundMetric(entry.fundamentals.salesGrowth5YPct).toFixed(2)}%`
              : "n/a"
        },
        {
          name: "Earnings growth",
          value:
            entry.fundamentals.earningsGrowthPct !== null
              ? `${roundMetric(entry.fundamentals.earningsGrowthPct).toFixed(2)}%`
              : "n/a"
        },
        {
          name: "Operating cash flow",
          value: croreText(entry.fundamentals.operatingCashFlowCrore)
        },
        {
          name: "Free cash flow",
          value: croreText(entry.fundamentals.freeCashFlowCrore)
        },
        {
          name: "Promoter holding",
          value:
            entry.fundamentals.promoterHoldingPct !== null
              ? `${roundMetric(entry.fundamentals.promoterHoldingPct).toFixed(2)}%`
              : "n/a"
        },
        ...(sectorContext && sectorContext.peerCount >= 3
          ? [
              {
                name: `${entry.sector} ROE median`,
                value: percentText(sectorContext.medianReturnOnEquityPct)
              },
              {
                name: `${entry.sector} D/E median`,
                value: ratioText(sectorContext.medianDebtToEquity)
              }
            ]
          : []),
        { name: "Revenue", value: croreText(entry.fundamentals.revenueCrore) },
        { name: "Profit", value: croreText(entry.fundamentals.profitCrore) }
      ]
    : [
        { name: "Sector", value: entry.sector },
        { name: "Industry", value: entry.industry ?? entry.sector },
        {
          name: "Fundamentals source",
          value:
            entry.researchStatus?.fundamentals.state === "cached"
              ? "Cached snapshot"
              : entry.researchStatus?.fundamentals.state === "live"
                ? "Live source"
                : "Unavailable"
        },
        { name: "Fundamental score", value: signalScoreText(fundamentalScore) },
        { name: "Market cap bucket", value: entry.marketCapBucket },
        { name: "Liquidity tier", value: entry.liquidityTier },
        { name: "20D volatility", value: percentText(metrics.volatility20) },
        {
          name: "52W range position",
          value:
            metrics.rangePosition !== null ? `${roundMetric(metrics.rangePosition).toFixed(1)}%` : "n/a"
        }
      ];

  const sentimentSignals: Signal[] = entry.sentiment
    ? [
        { name: "Sentiment score", value: signalScoreText(sentimentScore) },
        {
          name: "Headline sources",
          value:
            entry.researchStatus?.sentiment.state === "cached"
              ? "Cached snapshot"
              : entry.researchStatus?.sentiment.state === "live"
                ? "Live tagged feed"
                : "Unavailable"
        },
        { name: "Overall tone", value: entry.sentiment.overall },
        {
          name: "Headline balance",
          value: `${entry.sentiment.positiveCount} positive / ${entry.sentiment.negativeCount} negative`
        },
        { name: "Neutral headlines", value: `${entry.sentiment.neutralCount}` },
        { name: "NSE announcements", value: `${entry.sentiment.announcementCount}` }
      ]
    : [
        { name: "Sentiment score", value: signalScoreText(sentimentScore) },
        {
          name: "Headline sources",
          value:
            entry.researchStatus?.sentiment.state === "cached"
              ? "Cached snapshot"
              : entry.researchStatus?.sentiment.state === "live"
                ? "Live tagged feed"
                : "Unavailable"
        }
      ];

  const earningsSignals: Signal[] = [
    { name: "Earnings headline score", value: signalScoreText(earningsScore) },
    {
      name: "Earnings mentions",
      value: `${entry.sentiment?.earningsMentionCount ?? 0} recent headlines`
    },
    {
      name: "NSE announcements",
      value: `${entry.sentiment?.announcementCount ?? 0} tagged updates`
    }
  ];

  const analystSignals: Signal[] = [
    { name: "Analyst tone score", value: signalScoreText(analystScore) },
    {
      name: "Analyst mentions",
      value: `${entry.sentiment?.analystMentionCount ?? 0} recent headlines`
    }
  ];

  const marketContext = [
    `Latest session change: ${percentText(metrics.sessionChangePct)} while Nifty 50 moved ${percentText(metrics.benchmarkSessionChangePct)}.`,
    `Current price ${priceText(metrics.currentPrice)} versus 52-week range ${priceText(metrics.fiftyTwoWeekLow)} to ${priceText(metrics.fiftyTwoWeekHigh)}.`,
    `Current volume ${compactNumber(metrics.currentVolume)} versus 20-day average ${compactNumber(metrics.avgVolume20)}.`,
    ...(entry.sentiment?.headlines.slice(0, 3).map((headline) => `${headline.source}: ${headline.title}`) ?? [])
  ];

  return {
    score,
    conviction,
    entryPrice,
    targetPrice,
    stopLoss,
    expectedReturnPct: roundMetric(expectedReturnPct),
    riskReward,
    summary,
    drivers,
    analysisDrivers,
    technicalSignals,
    fundamentalSignals,
    sentimentSignals,
    earningsSignals,
    analystSignals,
    riskSignals: riskFeedback.signals,
    newsContext: marketContext
  };
}

function applyRanking(recommendations: StockAnalysis[]) {
  const ranked = recommendations.map((recommendation) => ({
    ...recommendation,
    profiles: {
      single_day: { ...recommendation.profiles.single_day },
      swing: { ...recommendation.profiles.swing },
      position: { ...recommendation.profiles.position },
      long_term: { ...recommendation.profiles.long_term }
    }
  }));

  for (const horizon of HORIZON_ORDER) {
    const settings = HORIZON_SETTINGS[horizon];
    const ordered = [...ranked].sort(
      (left, right) =>
        (right.profiles[horizon].score ?? right.profiles[horizon].expectedReturnPct) -
        (left.profiles[horizon].score ?? left.profiles[horizon].expectedReturnPct)
    );

    ordered.forEach((stock, index) => {
      stock.profiles[horizon].rank = index + 1;
      stock.profiles[horizon].isRecommended =
        index < settings.recommendationCount && meetsRecommendationGate(stock.profiles[horizon], settings);
    });
  }

  return ranked;
}

function buildCurrentRecommendationsForDate(
  date: string,
  liveSeries: MarketSeries[],
  benchmark: MarketSeries,
  learningMap?: StopLossLearningMap
) {
  const sectorContexts = buildSectorFundamentalContextMap(liveSeries);
  const recommendations = liveSeries
    .map((series) => {
      const index = series.indexByDate.get(date);

      if (index === undefined) {
        return null;
      }

      const metrics = snapshotMetrics(series, benchmark, index);

      if (!metrics) {
        return null;
      }

      const enrichedMetrics = enrichRelativeStrength(metrics);
      const sectorContext = sectorContexts.get(series.sector) ?? null;

      return {
        symbol: series.symbol,
        companyName: series.companyName,
        sector: series.sector,
        industry: series.industry,
        marketCapBucket: series.marketCapBucket,
        liquidityTier: series.liquidityTier,
        currentMarketPrice: roundPrice(enrichedMetrics.currentPrice),
        latestSessionChangePct: enrichedMetrics.sessionChangePct,
        fundamentals: series.fundamentals,
        sentiment: series.sentiment,
        researchStatus: series.researchStatus,
        profiles: {
          single_day: buildTradePlan(
            enrichedMetrics,
            series,
            "single_day",
            learningMap?.get(series.symbol)?.single_day ?? null,
            sectorContext
          ),
          swing: buildTradePlan(
            enrichedMetrics,
            series,
            "swing",
            learningMap?.get(series.symbol)?.swing ?? null,
            sectorContext
          ),
          position: buildTradePlan(
            enrichedMetrics,
            series,
            "position",
            learningMap?.get(series.symbol)?.position ?? null,
            sectorContext
          ),
          long_term: buildTradePlan(
            enrichedMetrics,
            series,
            "long_term",
            learningMap?.get(series.symbol)?.long_term ?? null,
            sectorContext
          )
        }
      } satisfies StockAnalysis;
    })
    .filter((recommendation): recommendation is StockAnalysis => recommendation !== null);

  return applyRanking(recommendations);
}

function resolveOutcomeResult(
  openPrice: number,
  targetPrice: number,
  stopLoss: number,
  targetHit: boolean,
  stopHit: boolean
): OutcomeResult {
  if (targetHit && stopHit) {
    return Math.abs(openPrice - stopLoss) <= Math.abs(targetPrice - openPrice)
      ? "stop_loss_hit"
      : "target_hit";
  }

  return targetHit ? "target_hit" : "stop_loss_hit";
}

function volumeContextText(currentVolume: number, baselineVolume: number | null) {
  if (baselineVolume === null || !Number.isFinite(baselineVolume) || baselineVolume <= 0) {
    return "";
  }

  if (currentVolume >= baselineVolume * 1.25) {
    return " on above-average volume";
  }

  if (currentVolume <= baselineVolume * 0.75) {
    return " on light volume";
  }

  return " on normal volume";
}

function describeOutcomeNote(
  series: MarketSeries,
  batchIndex: number,
  triggerIndex: number,
  result: OutcomeResult,
  entryPrice: number,
  targetPrice: number,
  stopLoss: number
) {
  const bar = series.bars[triggerIndex];
  const previousBar = series.bars[triggerIndex - 1] ?? null;
  const baselineVolume = average(
    series.bars
      .slice(Math.max(0, batchIndex - 10), batchIndex + 1)
      .map((historyBar) => historyBar.volume)
      .filter((volume) => volume > 0)
  );
  const volumeText = volumeContextText(bar.volume, baselineVolume);
  const supportBreakText =
    previousBar && bar.low < previousBar.low
      ? " after undercutting the prior session low"
      : "";
  const rejectionText =
    previousBar && bar.high < previousBar.high && bar.close < previousBar.close
      ? " with a failed rebound attempt"
      : "";

  if (result === "target_hit") {
    if (bar.open >= targetPrice) {
      return `The stock opened through the target on ${bar.date}, confirming strong follow-through${volumeText}.`;
    }

    return `Momentum extended enough to reach the target on ${bar.date}${volumeText}.`;
  }

  if (bar.open <= stopLoss) {
    return `The stock gapped below the stop-loss at the open on ${bar.date}, showing immediate downside failure${supportBreakText}${volumeText}.`;
  }

  if (bar.close < entryPrice) {
    return `Support failed intraday on ${bar.date}; price traded through the stop-loss and closed below the entry${supportBreakText}${rejectionText}${volumeText}.`;
  }

  return `Intraday volatility expanded enough to tag the stop-loss on ${bar.date}${supportBreakText}${rejectionText}${volumeText}.`;
}

function evaluateOutcome(
  series: MarketSeries,
  batchDate: string,
  horizon: HorizonId,
  entryPrice: number,
  targetPrice: number,
  stopLoss: number
): RecommendationOutcome {
  const batchIndex = series.indexByDate.get(batchDate);

  if (batchIndex === undefined) {
    return {
      result: "open",
      evaluatedOn: batchDate,
      holdingDays: 0,
      returnPct: 0,
      notes: "The recommendation date could not be mapped to live price history."
    };
  }

  const settings = HORIZON_SETTINGS[horizon];
  const lastIndex = Math.min(series.bars.length - 1, batchIndex + settings.maxHoldDays);

  for (let index = batchIndex + 1; index <= lastIndex; index += 1) {
    const bar = series.bars[index];
    const targetHit = bar.high >= targetPrice;
    const stopHit = bar.low <= stopLoss;

    if (!targetHit && !stopHit) {
      continue;
    }

    const result = resolveOutcomeResult(bar.open, targetPrice, stopLoss, targetHit, stopHit);
    const exitPrice = result === "target_hit" ? targetPrice : stopLoss;

    return {
      result,
      evaluatedOn: bar.date,
      holdingDays: index - batchIndex,
      returnPct: roundMetric(pctChange(exitPrice, entryPrice) ?? 0),
      notes: `${describeOutcomeNote(
        series,
        batchIndex,
        index,
        result,
        entryPrice,
        targetPrice,
        stopLoss
      )} The move completed after ${index - batchIndex} trading day(s).`
    };
  }

  const finalBar = series.bars[lastIndex];

  return {
    result: "open",
    evaluatedOn: finalBar.date,
    holdingDays: lastIndex - batchIndex,
    returnPct: roundMetric(pctChange(finalBar.close, entryPrice) ?? 0),
    notes: `The trade remains open after ${lastIndex - batchIndex} trading day(s); latest close is ${priceText(finalBar.close)}.`
  };
}

function deriveStopLossLearning(history: HistoricalBatch[]): StopLossLearningMap {
  const learningMap: StopLossLearningMap = new Map();

  for (const batch of [...history].sort((left, right) => right.batchDate.localeCompare(left.batchDate)).slice(0, 6)) {
    for (const recommendation of batch.recommendations) {
      const existing = learningMap.get(recommendation.symbol) ?? {};

      for (const horizon of HORIZON_ORDER) {
        const plan = recommendation.profiles[horizon];

        if (!plan.isRecommended || plan.outcome.result !== "stop_loss_hit") {
          continue;
        }

        const quickThreshold = Math.max(1, Math.ceil(HORIZON_SETTINGS[horizon].maxHoldDays / 3));
        const current = existing[horizon] ?? {
          penalty: 0,
          recentStopLosses: 0,
          quickStopLosses: 0,
          note: null
        };

        current.recentStopLosses += 1;

        if (plan.outcome.holdingDays <= quickThreshold) {
          current.quickStopLosses += 1;
        }

        existing[horizon] = current;
      }

      if (Object.keys(existing).length) {
        learningMap.set(recommendation.symbol, existing);
      }
    }
  }

  for (const [, horizons] of learningMap) {
    for (const horizon of HORIZON_ORDER) {
      const learning = horizons[horizon];

      if (!learning) {
        continue;
      }

      const slowerStopLosses = learning.recentStopLosses - learning.quickStopLosses;
      learning.penalty = roundMetric(clamp(learning.quickStopLosses * 4 + slowerStopLosses * 2, 0, 12));
      learning.note = `${learning.recentStopLosses} recent ${profileFor(horizon).label.toLowerCase()} stop-loss hit(s), including ${learning.quickStopLosses} quick failure(s), are reducing model aggressiveness.`;
    }
  }

  return learningMap;
}

function toHistoricalRecommendation(
  recommendation: StockAnalysis,
  batchDate: string,
  seriesBySymbol: Map<string, MarketSeries>
): HistoricalStockRecommendation {
  const series = seriesBySymbol.get(recommendation.symbol);

  if (!series) {
    throw new Error(`Missing series for ${recommendation.symbol}`);
  }

  const buildHistoricalPlan = (horizon: HorizonId): HistoricalRecommendationPlan => {
    const livePlan = recommendation.profiles[horizon];

    return {
      score: livePlan.score,
      rank: livePlan.rank,
      isRecommended: livePlan.isRecommended,
      conviction: livePlan.conviction,
      entryPrice: livePlan.entryPrice,
      targetPrice: livePlan.targetPrice,
      stopLoss: livePlan.stopLoss,
      summary: livePlan.summary,
      outcome: evaluateOutcome(
        series,
        batchDate,
        horizon,
        livePlan.entryPrice,
        livePlan.targetPrice,
        livePlan.stopLoss
      )
    };
  };

  return {
    symbol: recommendation.symbol,
    companyName: recommendation.companyName,
    sector: recommendation.sector,
    profiles: {
      single_day: buildHistoricalPlan("single_day"),
      swing: buildHistoricalPlan("swing"),
      position: buildHistoricalPlan("position"),
      long_term: buildHistoricalPlan("long_term")
    }
  };
}

function historicalBatchDates(benchmark: MarketSeries) {
  return benchmark.bars
    .slice(-(HISTORY_BATCH_COUNT + 1), -1)
    .map((bar) => bar.date)
    .filter((date) => date !== benchmark.bars.at(-1)?.date);
}

function buildHistoricalBatches(liveSeries: MarketSeries[], benchmark: MarketSeries) {
  const seriesBySymbol = new Map(liveSeries.map((series) => [series.symbol, series]));

  return historicalBatchDates(benchmark).map((date) => {
    const recommendations = buildCurrentRecommendationsForDate(date, liveSeries, benchmark).map(
      (recommendation) => toHistoricalRecommendation(recommendation, date, seriesBySymbol)
    );

    return {
      batchDate: date,
      publishedAt: publishedTimestamp(date),
      recommendations
    } satisfies HistoricalBatch;
  });
}

function liveDataSourceInfo(
  detail: string,
  analyzedSymbols: number,
  researchCoverage?: ResearchCoverage
): DataSourceInfo {
  return {
    mode: "live",
    provider: "Yahoo Finance chart data",
    asOf: new Date().toISOString(),
    detail,
    analyzedSymbols,
    researchCoverage
  };
}

function latestCommonTradingDate(series: MarketSeries, benchmark: MarketSeries) {
  for (let index = series.bars.length - 1; index >= 0; index -= 1) {
    const date = series.bars[index].date;

    if (benchmark.indexByDate.has(date)) {
      return date;
    }
  }

  return null;
}

function buildSearchStockForDate(
  date: string,
  series: MarketSeries,
  benchmark: MarketSeries,
  learningMap?: StopLossLearningMap,
  sectorContexts?: Map<string, FundamentalSectorContext>
) {
  const index = series.indexByDate.get(date);

  if (index === undefined) {
    return null;
  }

  const metrics = snapshotMetrics(series, benchmark, index);

  if (!metrics) {
    return null;
  }

  const enrichedMetrics = enrichRelativeStrength(metrics);
  const sectorContext = sectorContexts?.get(series.sector) ?? null;
  const buildSearchPlan = (horizon: HorizonId) => {
    const plan = buildTradePlan(
      enrichedMetrics,
      series,
      horizon,
      learningMap?.get(series.symbol)?.[horizon] ?? null,
      sectorContext
    );

    return {
      ...plan,
      rank: 1,
      isRecommended: meetsRecommendationGate(plan, HORIZON_SETTINGS[horizon])
    };
  };

  return {
    symbol: series.symbol,
    companyName: series.companyName,
    sector: series.sector,
    industry: series.industry,
    marketCapBucket: series.marketCapBucket,
    liquidityTier: series.liquidityTier,
    currentMarketPrice: roundPrice(enrichedMetrics.currentPrice),
    latestSessionChangePct: enrichedMetrics.sessionChangePct,
    fundamentals: series.fundamentals,
    sentiment: series.sentiment,
    researchStatus: series.researchStatus,
    profiles: {
      single_day: buildSearchPlan("single_day"),
      swing: buildSearchPlan("swing"),
      position: buildSearchPlan("position"),
      long_term: buildSearchPlan("long_term")
    }
  } satisfies StockAnalysis;
}

function searchVerdict(stock: StockAnalysis) {
  const recommendedHorizons = HORIZON_ORDER.filter((horizon) => stock.profiles[horizon].isRecommended);
  const focusHorizon =
    recommendedHorizons[0] ??
    [...HORIZON_ORDER].sort(
      (left, right) =>
        (stock.profiles[right].score ?? stock.profiles[right].expectedReturnPct) -
        (stock.profiles[left].score ?? stock.profiles[left].expectedReturnPct)
    )[0];
  const focusPlan = stock.profiles[focusHorizon];
  const positiveReason = focusPlan.analysisDrivers?.find((driver) => driver.impact === "positive");
  const cautionReason =
    focusPlan.analysisDrivers?.find((driver) => driver.area === "risk" && driver.impact === "negative") ??
    focusPlan.analysisDrivers?.find((driver) => driver.impact === "negative");

  if (!recommendedHorizons.length) {
    return {
      recommendedHorizons,
      shouldConsider: false,
      verdict: cautionReason
        ? `Do not prioritize this stock right now. The biggest drag is ${cautionReason.title.toLowerCase()}: ${cautionReason.detail}`
        : "Do not prioritize this stock right now. Its current technical, fundamental, and sentiment mix is below the recommendation threshold across all supported horizons."
    };
  }

  const labels = recommendedHorizons.map((horizon) => HORIZON_SETTINGS[horizon].label.toLowerCase());

  return {
    recommendedHorizons,
    shouldConsider: true,
    verdict: positiveReason
      ? `Consider this stock for ${labels.join(", ")} setups. The main support is ${positiveReason.title.toLowerCase()}: ${positiveReason.detail}${cautionReason ? ` Main caution: ${cautionReason.detail}` : ""}`
      : `Consider this stock for ${labels.join(", ")} setups. The current score clears the model threshold for those horizons.`
  };
}

function fallbackDataSourceInfo(
  mode: "cached" | "sample",
  detail: string,
  analyzedSymbols: number
): DataSourceInfo {
  return {
    mode,
    provider: mode === "cached" ? "Local generated snapshot" : "Sample fallback dataset",
    asOf: new Date().toISOString(),
    detail,
    analyzedSymbols
  };
}

async function buildLiveDataset() {
  setRefreshJobStatus({
    state: "running",
    phase: "loading-benchmark",
    detail: `Loading benchmark ${BENCHMARK.symbol} and preparing cached research inputs.`,
    percentComplete: 3,
    processedSymbols: 0,
    totalSymbols: MARKET_UNIVERSE.length,
    error: null
  });
  const cachedResearchDataset = await readGeneratedDataset();
  const cachedResearchMap = buildCachedResearchMap(cachedResearchDataset);
  const benchmark = await fetchSeries(BENCHMARK);
  const minimumLiveSymbols = minimumLiveSymbolsRequired();
  let processedSymbols = 0;
  const liveSeries = (
    await mapWithConcurrency(MARKET_UNIVERSE, LIVE_FETCH_CONCURRENCY, async (entry) => {
      try {
        return await fetchSeries(entry, cachedResearchMap.get(entry.symbol) ?? null);
      } finally {
        processedSymbols += 1;
        setRefreshJobStatus({
          state: "running",
          phase: "refreshing-symbols",
          detail: `Refreshing live market data for ${processedSymbols}/${MARKET_UNIVERSE.length} NSE symbols.`,
          percentComplete: symbolRefreshPercent(processedSymbols, MARKET_UNIVERSE.length),
          processedSymbols,
          totalSymbols: MARKET_UNIVERSE.length
        });
      }
    })
  ).filter((series): series is MarketSeries => series !== null);

  if (!benchmark || liveSeries.length < minimumLiveSymbols) {
    return null;
  }

  const latestDate = benchmark.bars.at(-1)?.date;

  if (!latestDate) {
    return null;
  }

  setRefreshJobStatus({
    state: "running",
    phase: "scoring-models",
    detail: "Scoring technical, fundamental, sentiment, and risk models for the refreshed universe.",
    percentComplete: 88,
    processedSymbols: MARKET_UNIVERSE.length,
    totalSymbols: MARKET_UNIVERSE.length
  });
  const history = buildHistoricalBatches(liveSeries, benchmark);
  const learningMap = deriveStopLossLearning(history);
  const researchCoverage = collectResearchCoverage(liveSeries);
  const currentRecommendations = buildCurrentRecommendationsForDate(
    latestDate,
    liveSeries,
    benchmark,
    learningMap
  );

  if (currentRecommendations.length < minimumLiveSymbols) {
    return null;
  }

  setRefreshJobStatus({
    state: "running",
    phase: "persisting-snapshot",
    detail: "Persisting the refreshed snapshot and archive files.",
    percentComplete: 96,
    processedSymbols: MARKET_UNIVERSE.length,
    totalSymbols: MARKET_UNIVERSE.length
  });
  const dataset: RecommendationDataset = normalizeDataset({
    market: "Indian Equities",
    exchange: "NSE",
    universe: `Nifty 100 universe (${liveSeries.length} live symbols)`,
    dataSource: liveDataSourceInfo(
      `${liveSeries.length}/${MARKET_UNIVERSE.length} Nifty 100 symbols refreshed successfully with benchmark ${BENCHMARK.symbol}. Fundamentals: ${researchCoverage.fundamentalsLive} live / ${researchCoverage.fundamentalsCached} cached / ${researchCoverage.fundamentalsUnavailable} unavailable. News: ${researchCoverage.sentimentLive} live / ${researchCoverage.sentimentCached} cached / ${researchCoverage.sentimentUnavailable} unavailable. Tagged headlines: ${researchCoverage.nseAnnouncementHeadlines} NSE announcements, ${researchCoverage.googleNewsHeadlines} Google News.`,
      liveSeries.length,
      researchCoverage
    ),
    profiles: PROFILE_LIST,
    currentBatch: {
      batchDate: latestDate,
      generatedAt: new Date().toISOString(),
      recommendations: currentRecommendations
    },
    history
  });
  const persisted = await writeGeneratedDataset(dataset);
  const finalDataset = {
    ...dataset,
    dataSource: liveDataSourceInfo(
      `${liveSeries.length}/${MARKET_UNIVERSE.length} Nifty 100 symbols refreshed successfully with benchmark ${BENCHMARK.symbol}. Fundamentals: ${researchCoverage.fundamentalsLive} live / ${researchCoverage.fundamentalsCached} cached / ${researchCoverage.fundamentalsUnavailable} unavailable. News: ${researchCoverage.sentimentLive} live / ${researchCoverage.sentimentCached} cached / ${researchCoverage.sentimentUnavailable} unavailable. Tagged headlines: ${researchCoverage.nseAnnouncementHeadlines} NSE announcements, ${researchCoverage.googleNewsHeadlines} Google News.${persisted.latestSnapshot ? " Latest snapshot persisted locally." : " Persistent filesystem cache was unavailable, so the app is using in-memory caching for this runtime."}${persisted.archivedBatch ? " Daily batch snapshot archived." : " Daily batch archive write was unavailable."}`,
      liveSeries.length,
      researchCoverage
    )
  };

  return rememberDataset(finalDataset);
}

function annotateFallbackDataset(
  dataset: RecommendationDataset,
  mode: "cached" | "sample",
  detail: string
): RecommendationDataset {
  return {
    ...dataset,
    dataSource: fallbackDataSourceInfo(mode, detail, dataset.currentBatch.recommendations.length)
  };
}

export async function loadRecommendationData(): Promise<RecommendationDataset> {
  const memoryDataset = readDatasetMemoryCache();

  if (memoryDataset) {
    return memoryDataset;
  }

  const cachedDataset = await readGeneratedDataset();

  if (cachedDataset) {
    return rememberDataset(
      annotateFallbackDataset(
        cachedDataset,
        "cached",
        `Using the last successful live snapshot from ${cachedDataset.currentBatch.generatedAt}.`
      )
    );
  }

  const liveDataset = await buildLiveDataset();

  if (liveDataset) {
    return liveDataset;
  }

  return rememberDataset(
    annotateFallbackDataset(
      await readSampleDataset(),
      "sample",
      "Live market requests failed and no cached snapshot was available, so the demo dataset is being shown."
    )
  );
}

export async function analyzeSearchSymbol(
  query: string,
  referenceDataset?: RecommendationDataset
): Promise<SearchAnalysisResult | null> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return null;
  }

  try {
    const lookup = await lookupNseSymbol(trimmedQuery);

    if (!lookup) {
      return {
        status: "not_found",
        query: trimmedQuery,
        symbol: trimmedQuery.toUpperCase(),
        companyName: trimmedQuery.toUpperCase(),
        sector: "Unknown",
        industry: undefined,
        shouldConsider: false,
        verdict: "The symbol could not be resolved to an NSE-listed equity.",
        recommendedHorizons: [],
        stock: null,
        message: "Try an NSE trading symbol such as RELIANCE, INFY, or ICICIBANK."
      };
    }

    const learningSource = referenceDataset ?? (await readGeneratedDataset());
    const cachedResearchMap = buildCachedResearchMap(learningSource);
    const benchmark = await fetchSeries(BENCHMARK);
    const series = await fetchSeries({
      symbol: lookup.symbol,
      yahooSymbol: lookup.yahooSymbol,
      fallbackCompanyName: lookup.companyName,
      sector: lookup.sector,
      industry: lookup.industry,
      marketCapBucket: "Large Cap",
      liquidityTier: "Tier 2"
    }, cachedResearchMap.get(lookup.symbol) ?? null);

    if (!benchmark || !series) {
      return {
        status: "error",
        query: trimmedQuery,
        symbol: lookup.symbol,
        companyName: lookup.companyName,
        sector: lookup.sector,
        industry: lookup.industry,
        shouldConsider: false,
        verdict: "Live analysis could not be completed for this symbol.",
        recommendedHorizons: [],
        stock: null,
        message: "The live chart or benchmark request failed while evaluating this stock."
      };
    }

    const analysisDate = latestCommonTradingDate(series, benchmark);

    if (!analysisDate) {
      return {
        status: "error",
        query: trimmedQuery,
        symbol: lookup.symbol,
        companyName: lookup.companyName,
        sector: lookup.sector,
        industry: lookup.industry,
        shouldConsider: false,
        verdict: "Live analysis could not be completed for this symbol.",
        recommendedHorizons: [],
        stock: null,
        message: "The stock does not have enough overlapping benchmark history for scoring."
      };
    }

    const sectorContexts = learningSource
      ? buildSectorFundamentalContextMap(learningSource.currentBatch.recommendations)
      : undefined;
    const stock = buildSearchStockForDate(
      analysisDate,
      series,
      benchmark,
      learningSource ? deriveStopLossLearning(learningSource.history) : undefined,
      sectorContexts
    );

    if (!stock) {
      return {
        status: "error",
        query: trimmedQuery,
        symbol: lookup.symbol,
        companyName: lookup.companyName,
        sector: lookup.sector,
        industry: lookup.industry,
        shouldConsider: false,
        verdict: "Live analysis could not be completed for this symbol.",
        recommendedHorizons: [],
        stock: null,
        message: "There was not enough price history to compute the required signals."
      };
    }

    const verdict = searchVerdict(stock);

    return {
      status: "analyzed",
      query: trimmedQuery,
      symbol: stock.symbol,
      companyName: stock.companyName,
      sector: stock.sector,
      industry: stock.industry,
      shouldConsider: verdict.shouldConsider,
      verdict: verdict.verdict,
      recommendedHorizons: verdict.recommendedHorizons,
      stock
    };
  } catch {
    return {
      status: "error",
      query: trimmedQuery,
      symbol: trimmedQuery.toUpperCase(),
      companyName: trimmedQuery.toUpperCase(),
      sector: "Unknown",
      industry: undefined,
      shouldConsider: false,
      verdict: "Live analysis could not be completed for this symbol.",
      recommendedHorizons: [],
      stock: null,
      message: "A live market or research request failed while analyzing this stock."
    };
  }
}

export async function analyzeSearchSymbolWithTimeout(
  query: string,
  referenceDataset?: RecommendationDataset,
  timeoutMs = 8000
): Promise<SearchAnalysisResult | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    analyzeSearchSymbol(query, referenceDataset),
    new Promise<SearchAnalysisResult | null>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(null), Math.max(1000, timeoutMs));
    })
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}
