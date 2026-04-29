import {
  getMarketRefreshReadiness,
  getRecommendationRefreshStatus,
  listAutomationRuns,
  loadRecommendationSnapshot
} from "@/lib/recommendation-data";
import type {
  DataSourceInfo,
  RecommendationDataset,
  ResearchSourceState,
  ResearchSourceStatus,
  StockAnalysis
} from "@/lib/types";
import type {
  AutomationRunRecord,
  MarketRefreshReadiness,
  RecommendationRefreshStatus
} from "@/lib/recommendation-data";

export type MonitoringSeverity = "ok" | "warning" | "danger";
type SourceLayerId = "fundamentals" | "sentiment" | "derivatives";

export type SourceProviderSummary = {
  provider: string;
  count: number;
};

export type SourceLayerSummary = {
  id: SourceLayerId;
  label: string;
  live: number;
  cached: number;
  unavailable: number;
  total: number;
  successRatePct: number | null;
  latestObservedAt: string | null;
  providers: SourceProviderSummary[];
  failureSamples: Array<{
    symbol: string;
    detail: string;
  }>;
  coverageSource: "refresh-coverage" | "stock-status";
};

export type FreshnessSummary = {
  expectedBatchDate: string;
  latestBatchDate: string | null;
  currentBatchDate: string;
  generatedAt: string;
  ageDays: number | null;
  generatedAgeHours: number | null;
  isFresh: boolean;
  isTradingDay: boolean;
  isMarketSession: boolean;
  shouldRefresh: boolean;
  detail: string;
};

export type RetryPolicySummary = {
  intervalHours: number;
  retryCount: number;
  retryDelayMs: number;
  refreshUrl: string;
};

export type MonitoringAlert = {
  severity: MonitoringSeverity;
  title: string;
  detail: string;
};

export type MonitoringEvent = {
  id: string;
  timestamp: string;
  severity: MonitoringSeverity;
  event: string;
  message: string;
  fields: Record<string, string | number | boolean | null>;
};

export type MonitoringSnapshot = {
  generatedAt: string;
  status: MonitoringSeverity;
  dataSource: DataSourceInfo | null;
  analyzedSymbols: number;
  sourceHealth: SourceLayerSummary[];
  freshness: FreshnessSummary;
  refresh: RecommendationRefreshStatus;
  automation: {
    latestRun: AutomationRunRecord | null;
    recentRuns: AutomationRunRecord[];
    retryPolicy: RetryPolicySummary;
  };
  alerts: MonitoringAlert[];
  events: MonitoringEvent[];
};

const DEFAULT_REFRESH_URL = "http://localhost:3000/api/refresh-market-data";

const SOURCE_LAYERS: Array<{
  id: SourceLayerId;
  label: string;
}> = [
  {
    id: "fundamentals",
    label: "Fundamentals"
  },
  {
    id: "sentiment",
    label: "News and sentiment"
  },
  {
    id: "derivatives",
    label: "NSE futures/options"
  }
];

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function dateOnlyTime(value: string | null) {
  if (!value) {
    return null;
  }

  const time = new Date(`${value}T12:00:00Z`).getTime();
  return Number.isFinite(time) ? time : null;
}

function dateTimeAgeHours(value: string, now: Date) {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return null;
  }

  return Math.max(0, Math.round(((now.getTime() - time) / (60 * 60 * 1000)) * 10) / 10);
}

function batchAgeDays(expectedBatchDate: string, latestBatchDate: string | null) {
  const expectedTime = dateOnlyTime(expectedBatchDate);
  const latestTime = dateOnlyTime(latestBatchDate);

  if (expectedTime === null || latestTime === null) {
    return null;
  }

  return Math.max(0, Math.round((expectedTime - latestTime) / (24 * 60 * 60 * 1000)));
}

function fallbackStatus(
  provider: string,
  state: ResearchSourceState,
  detail: string,
  observedAt: string,
  itemCount?: number
): ResearchSourceStatus {
  return {
    provider,
    state,
    detail,
    observedAt,
    itemCount
  };
}

function sourceStatusFor(
  stock: StockAnalysis,
  layer: SourceLayerId,
  fallbackObservedAt: string
): ResearchSourceStatus {
  switch (layer) {
    case "fundamentals":
      return (
        stock.researchStatus?.fundamentals ??
        (stock.fundamentals
          ? fallbackStatus(
              stock.fundamentals.source || "Saved fundamentals",
              "cached",
              "Saved fundamentals exist, but this snapshot predates per-source status metadata.",
              fallbackObservedAt
            )
          : fallbackStatus(
              "Fundamentals",
              "unavailable",
              "No fundamentals snapshot or source status was saved for this stock.",
              fallbackObservedAt
            ))
      );
    case "sentiment":
      return (
        stock.researchStatus?.sentiment ??
        (stock.sentiment
          ? fallbackStatus(
              "Saved headlines",
              "cached",
              "Saved sentiment exists, but this snapshot predates per-source status metadata.",
              fallbackObservedAt,
              stock.sentiment.headlines.length
            )
          : fallbackStatus(
              "News",
              "unavailable",
              "No sentiment snapshot or source status was saved for this stock.",
              fallbackObservedAt
            ))
      );
    case "derivatives":
      return (
        stock.researchStatus?.derivatives ??
        (stock.derivatives
          ? fallbackStatus(
              stock.derivatives.source || "NSE derivatives",
              "cached",
              "Saved derivatives exist, but this snapshot predates per-source status metadata.",
              stock.derivatives.observedAt || fallbackObservedAt
            )
          : fallbackStatus(
              "NSE derivatives",
              "unavailable",
              "No NSE futures/options snapshot or source status was saved for this stock.",
              fallbackObservedAt
            ))
      );
  }
}

function coverageCounts(
  coverage: NonNullable<DataSourceInfo["researchCoverage"]> | undefined,
  layer: SourceLayerId
) {
  if (!coverage) {
    return null;
  }

  switch (layer) {
    case "fundamentals":
      return {
        live: coverage.fundamentalsLive,
        cached: coverage.fundamentalsCached,
        unavailable: coverage.fundamentalsUnavailable
      };
    case "sentiment":
      return {
        live: coverage.sentimentLive,
        cached: coverage.sentimentCached,
        unavailable: coverage.sentimentUnavailable
      };
    case "derivatives":
      return {
        live: coverage.derivativesLive ?? 0,
        cached: coverage.derivativesCached ?? 0,
        unavailable: coverage.derivativesUnavailable ?? 0
      };
  }
}

function providerSummaries(providers: Map<string, number>) {
  return [...providers.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((left, right) => right.count - left.count || left.provider.localeCompare(right.provider))
    .slice(0, 6);
}

function latestTimestamp(left: string | null, right: string | null) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function summarizeSourceLayer(
  dataset: RecommendationDataset,
  layer: SourceLayerId,
  label: string
): SourceLayerSummary {
  const stocks = dataset.currentBatch.recommendations;
  const statusCounts: Record<ResearchSourceState, number> = {
    live: 0,
    cached: 0,
    unavailable: 0
  };
  const providers = new Map<string, number>();
  const failureSamples: SourceLayerSummary["failureSamples"] = [];
  let latestObservedAt: string | null = null;

  for (const stock of stocks) {
    const status = sourceStatusFor(stock, layer, dataset.currentBatch.generatedAt);
    statusCounts[status.state] += 1;
    providers.set(status.provider, (providers.get(status.provider) ?? 0) + 1);
    latestObservedAt = latestTimestamp(latestObservedAt, status.observedAt);

    if (status.state === "unavailable" && failureSamples.length < 5) {
      failureSamples.push({
        symbol: stock.symbol,
        detail: status.detail
      });
    }
  }

  const coverage = coverageCounts(dataset.dataSource?.researchCoverage, layer);
  const live = coverage?.live ?? statusCounts.live;
  const cached = coverage?.cached ?? statusCounts.cached;
  const unavailable = coverage?.unavailable ?? statusCounts.unavailable;
  const total = live + cached + unavailable;

  return {
    id: layer,
    label,
    live,
    cached,
    unavailable,
    total,
    successRatePct: total ? Math.round(((live + cached) / total) * 1000) / 10 : null,
    latestObservedAt,
    providers: providerSummaries(providers),
    failureSamples,
    coverageSource: coverage ? "refresh-coverage" : "stock-status"
  };
}

function buildFreshnessSummary(
  dataset: RecommendationDataset,
  readiness: MarketRefreshReadiness,
  now: Date
): FreshnessSummary {
  const latestBatchDate = readiness.latestBatchDate ?? dataset.currentBatch.batchDate;

  return {
    expectedBatchDate: readiness.expectedBatchDate,
    latestBatchDate,
    currentBatchDate: dataset.currentBatch.batchDate,
    generatedAt: dataset.currentBatch.generatedAt,
    ageDays: batchAgeDays(readiness.expectedBatchDate, latestBatchDate),
    generatedAgeHours: dateTimeAgeHours(dataset.currentBatch.generatedAt, now),
    isFresh: latestBatchDate >= readiness.expectedBatchDate,
    isTradingDay: readiness.isTradingDay,
    isMarketSession: readiness.isMarketSession,
    shouldRefresh: readiness.shouldRefresh,
    detail: readiness.detail
  };
}

function buildRetryPolicy(): RetryPolicySummary {
  return {
    intervalHours: parsePositiveNumber(process.env.MARKET_REFRESH_INTERVAL_HOURS, 5),
    retryCount: parsePositiveInteger(process.env.MARKET_REFRESH_RETRIES, 2),
    retryDelayMs: parsePositiveInteger(process.env.MARKET_REFRESH_RETRY_DELAY_MS, 15000),
    refreshUrl: process.env.MARKET_REFRESH_URL || DEFAULT_REFRESH_URL
  };
}

function sourceAlerts(sourceHealth: SourceLayerSummary[]): MonitoringAlert[] {
  return sourceHealth
    .filter((source) => source.unavailable > 0)
    .map((source) => ({
      severity: "warning",
      title: `${source.label} has unavailable symbols`,
      detail: `${source.unavailable}/${source.total} source checks were unavailable in the latest snapshot.`
    }));
}

function buildAlerts(
  dataset: RecommendationDataset,
  freshness: FreshnessSummary,
  refresh: RecommendationRefreshStatus,
  automationRuns: AutomationRunRecord[],
  sourceHealth: SourceLayerSummary[]
): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];

  if (!freshness.isFresh) {
    alerts.push({
      severity: "warning",
      title: "Saved batch is behind expected market date",
      detail: `Latest saved batch is ${freshness.latestBatchDate ?? "missing"}; expected ${freshness.expectedBatchDate}.`
    });
  }

  if (freshness.shouldRefresh) {
    alerts.push({
      severity: "warning",
      title: "Refresh is due during market session",
      detail: freshness.detail
    });
  }

  if (dataset.dataSource?.mode === "sample") {
    alerts.push({
      severity: "danger",
      title: "Sample fallback is active",
      detail: dataset.dataSource.detail
    });
  } else if (dataset.dataSource?.mode === "cached" && !freshness.isFresh) {
    alerts.push({
      severity: "warning",
      title: "Cached fallback is stale",
      detail: dataset.dataSource.detail
    });
  }

  if (refresh.state === "failed") {
    alerts.push({
      severity: "danger",
      title: "Latest refresh failed",
      detail: refresh.error ?? refresh.detail
    });
  }

  const latestRun = automationRuns[0] ?? null;

  if (!latestRun) {
    alerts.push({
      severity: "warning",
      title: "No automation run has been recorded",
      detail: "Run the scheduler script once or configure Task Scheduler/cron to create a run history."
    });
  } else if (latestRun.status === "failed") {
    alerts.push({
      severity: "danger",
      title: "Latest automation run failed",
      detail: latestRun.error ?? latestRun.detail
    });
  }

  return [...alerts, ...sourceAlerts(sourceHealth)];
}

function severityRank(severity: MonitoringSeverity) {
  switch (severity) {
    case "danger":
      return 2;
    case "warning":
      return 1;
    case "ok":
      return 0;
  }
}

function overallStatus(alerts: MonitoringAlert[]) {
  if (alerts.some((alert) => alert.severity === "danger")) {
    return "danger";
  }

  if (alerts.some((alert) => alert.severity === "warning")) {
    return "warning";
  }

  return "ok";
}

function automationSeverity(status: AutomationRunRecord["status"]): MonitoringSeverity {
  switch (status) {
    case "failed":
      return "danger";
    case "running":
    case "skipped":
      return "warning";
    case "succeeded":
      return "ok";
  }
}

function refreshSeverity(status: RecommendationRefreshStatus["state"]): MonitoringSeverity {
  switch (status) {
    case "failed":
      return "danger";
    case "running":
      return "warning";
    case "idle":
    case "succeeded":
      return "ok";
  }
}

function buildEvents(
  now: string,
  snapshotStatus: MonitoringSeverity,
  dataset: RecommendationDataset,
  freshness: FreshnessSummary,
  refresh: RecommendationRefreshStatus,
  sourceHealth: SourceLayerSummary[],
  automationRuns: AutomationRunRecord[]
): MonitoringEvent[] {
  const events: MonitoringEvent[] = [
    {
      id: `monitoring.snapshot.${now}`,
      timestamp: now,
      severity: snapshotStatus,
      event: "monitoring.snapshot",
      message: `Monitoring snapshot generated for batch ${dataset.currentBatch.batchDate}.`,
      fields: {
        status: snapshotStatus,
        analyzedSymbols: dataset.currentBatch.recommendations.length,
        dataSourceMode: dataset.dataSource?.mode ?? null
      }
    },
    {
      id: `market.freshness.${freshness.expectedBatchDate}`,
      timestamp: now,
      severity: freshness.isFresh ? "ok" : "warning",
      event: "market.freshness",
      message: freshness.detail,
      fields: {
        expectedBatchDate: freshness.expectedBatchDate,
        latestBatchDate: freshness.latestBatchDate,
        shouldRefresh: freshness.shouldRefresh,
        ageDays: freshness.ageDays
      }
    },
    {
      id: `refresh.status.${refresh.state}.${refresh.startedAt ?? now}`,
      timestamp: refresh.finishedAt ?? refresh.startedAt ?? now,
      severity: refreshSeverity(refresh.state),
      event: "refresh.status",
      message: refresh.detail,
      fields: {
        state: refresh.state,
        phase: refresh.phase,
        percentComplete: refresh.percentComplete,
        processedSymbols: refresh.processedSymbols,
        totalSymbols: refresh.totalSymbols
      }
    },
    ...sourceHealth.map((source) => ({
      id: `source.${source.id}.${now}`,
      timestamp: source.latestObservedAt ?? now,
      severity: source.unavailable > 0 ? ("warning" as const) : ("ok" as const),
      event: "source.health",
      message: `${source.label}: ${source.live} live, ${source.cached} cached, ${source.unavailable} unavailable.`,
      fields: {
        layer: source.id,
        live: source.live,
        cached: source.cached,
        unavailable: source.unavailable,
        successRatePct: source.successRatePct
      }
    })),
    ...automationRuns.slice(0, 12).map((run) => ({
      id: `automation.run.${run.id}`,
      timestamp: run.finishedAt ?? run.startedAt,
      severity: automationSeverity(run.status),
      event: "automation.run",
      message: run.detail,
      fields: {
        trigger: run.trigger,
        status: run.status,
        expectedBatchDate: run.expectedBatchDate,
        batchDate: run.batchDate,
        force: run.force,
        processedSymbols: run.processedSymbols,
        totalSymbols: run.totalSymbols
      }
    }))
  ];

  return events
    .sort((left, right) => {
      const timeDelta = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();

      if (timeDelta !== 0) {
        return timeDelta;
      }

      return severityRank(right.severity) - severityRank(left.severity);
    })
    .slice(0, 30);
}

export async function buildMonitoringSnapshot(): Promise<MonitoringSnapshot> {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const [dataset, readiness, automationRuns] = await Promise.all([
    loadRecommendationSnapshot(),
    getMarketRefreshReadiness(),
    listAutomationRuns(20)
  ]);
  const refresh = getRecommendationRefreshStatus();
  const sourceHealth = SOURCE_LAYERS.map((layer) => summarizeSourceLayer(dataset, layer.id, layer.label));
  const freshness = buildFreshnessSummary(dataset, readiness, nowDate);
  const alerts = buildAlerts(dataset, freshness, refresh, automationRuns, sourceHealth);
  const status = overallStatus(alerts);

  return {
    generatedAt: now,
    status,
    dataSource: dataset.dataSource ?? null,
    analyzedSymbols: dataset.currentBatch.recommendations.length,
    sourceHealth,
    freshness,
    refresh,
    automation: {
      latestRun: automationRuns[0] ?? null,
      recentRuns: automationRuns.slice(0, 10),
      retryPolicy: buildRetryPolicy()
    },
    alerts,
    events: buildEvents(now, status, dataset, freshness, refresh, sourceHealth, automationRuns)
  };
}
