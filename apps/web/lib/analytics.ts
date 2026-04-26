import type {
  BacktestEvaluation,
  ConfidenceCalibrationBucket,
  DailyPerformance,
  HistoricalBatch,
  HistoricalRecommendationPlan,
  HorizonId,
  OutcomeResult,
  RecommendationDataset,
  StockPerformanceHistoryEntry
} from "@/lib/types";

const CLOSED_RESULTS: OutcomeResult[] = ["target_hit", "stop_loss_hit"];
const HORIZON_LABELS: Record<HorizonId, string> = {
  single_day: "Single-day",
  swing: "Swing",
  position: "Position",
  long_term: "Long-term"
};
const HORIZON_THRESHOLDS: Record<HorizonId, number> = {
  single_day: 54,
  swing: 56,
  position: 58,
  long_term: 60
};

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function isClosedResult(result: OutcomeResult) {
  return CLOSED_RESULTS.includes(result);
}

function isSuccessfulResult(result: OutcomeResult) {
  return result === "target_hit";
}

function isRecommendedPlan(plan: { isRecommended?: boolean }) {
  return plan.isRecommended ?? true;
}

function planAverageReturn(plans: HistoricalRecommendationPlan[]) {
  const closedPlans = plans.filter(
    (plan) => isRecommendedPlan(plan) && isClosedResult(plan.outcome.result)
  );

  if (!closedPlans.length) {
    return null;
  }

  const average =
    closedPlans.reduce((total, plan) => total + plan.outcome.returnPct, 0) / closedPlans.length;

  return roundMetric(average);
}

function average(values: Array<number | null | undefined>) {
  const resolved = values.filter((value): value is number => value !== null && value !== undefined);

  if (!resolved.length) {
    return null;
  }

  return roundMetric(resolved.reduce((total, value) => total + value, 0) / resolved.length);
}

function maxDrawdown(plans: Array<{ batchDate: string; plan: HistoricalRecommendationPlan }>) {
  const closedPlans = [...plans]
    .filter(({ plan }) => isRecommendedPlan(plan) && isClosedResult(plan.outcome.result))
    .sort((left, right) => left.batchDate.localeCompare(right.batchDate));

  if (!closedPlans.length) {
    return null;
  }

  let equity = 100;
  let peak = 100;
  let worstDrawdown = 0;

  for (const { plan } of closedPlans) {
    equity *= 1 + plan.outcome.returnPct / 100;
    peak = Math.max(peak, equity);
    worstDrawdown = Math.max(worstDrawdown, ((peak - equity) / peak) * 100);
  }

  return roundMetric(worstDrawdown);
}

function confidenceBucketLabel(plan: HistoricalRecommendationPlan, horizon: HorizonId) {
  const threshold = HORIZON_THRESHOLDS[horizon];
  const score = plan.score ?? 0;

  if (score >= threshold + 8) {
    return "High confidence";
  }

  if (score >= threshold) {
    return "Tradable";
  }

  if (score >= threshold - 8) {
    return "Needs confirmation";
  }

  return "Low score";
}

function buildConfidenceCalibration(
  plans: HistoricalRecommendationPlan[],
  horizon: HorizonId
): ConfidenceCalibrationBucket[] {
  const buckets = new Map<string, HistoricalRecommendationPlan[]>();

  for (const plan of plans.filter(isRecommendedPlan)) {
    const label = confidenceBucketLabel(plan, horizon);
    buckets.set(label, [...(buckets.get(label) ?? []), plan]);
  }

  return ["High confidence", "Tradable", "Needs confirmation", "Low score"]
    .map((label) => {
      const bucketPlans = buckets.get(label) ?? [];
      const closedPlans = bucketPlans.filter((plan) => isClosedResult(plan.outcome.result));
      const wins = closedPlans.filter((plan) => isSuccessfulResult(plan.outcome.result)).length;

      return {
        label,
        total: bucketPlans.length,
        closed: closedPlans.length,
        averageScore: average(bucketPlans.map((plan) => plan.score ?? null)),
        hitRate: closedPlans.length ? roundMetric((wins / closedPlans.length) * 100) : null,
        averageReturnPct: average(closedPlans.map((plan) => plan.outcome.returnPct))
      };
    })
    .filter((bucket) => bucket.total > 0);
}

export function buildDailyPerformance(
  history: RecommendationDataset["history"],
  horizon: HorizonId
): DailyPerformance[] {
  return [...history]
    .sort((left, right) => right.batchDate.localeCompare(left.batchDate))
    .map((batch) => {
      const plans = batch.recommendations
        .map((recommendation) => recommendation.profiles[horizon])
        .filter((plan) => isRecommendedPlan(plan));
      const successful = plans.filter((plan) => isSuccessfulResult(plan.outcome.result)).length;
      const failed = plans.filter((plan) => plan.outcome.result === "stop_loss_hit").length;
      const open = plans.filter((plan) => plan.outcome.result === "open").length;
      const closed = successful + failed;

      return {
        batchDate: batch.batchDate,
        publishedAt: batch.publishedAt,
        total: plans.length,
        closed,
        open,
        successful,
        failed,
        successRate: closed ? roundMetric((successful / closed) * 100) : null,
        averageReturnPct: planAverageReturn(plans)
      };
    });
}

export function buildPerformanceSummary(rows: DailyPerformance[]) {
  const completedRows = rows.filter((row) => row.successRate !== null);
  const latestCompleted = completedRows[0] ?? null;

  if (!completedRows.length) {
    return {
      latestCompleted,
      averageSuccessRate: null,
      averageClosedReturnPct: null
    };
  }

  const averageSuccessRate =
    completedRows.reduce((total, row) => total + (row.successRate ?? 0), 0) / completedRows.length;

  const returnRows = completedRows.filter((row) => row.averageReturnPct !== null);
  const averageClosedReturnPct = returnRows.length
    ? returnRows.reduce((total, row) => total + (row.averageReturnPct ?? 0), 0) / returnRows.length
    : null;

  return {
    latestCompleted,
    averageSuccessRate: roundMetric(averageSuccessRate),
    averageClosedReturnPct:
      averageClosedReturnPct === null ? null : roundMetric(averageClosedReturnPct)
  };
}

export function buildBacktestEvaluation(dataset: RecommendationDataset): BacktestEvaluation {
  const horizons = dataset.profiles.map((profile) => {
    const datedPlans = dataset.history.flatMap((batch) =>
      batch.recommendations.map((recommendation) => ({
        batchDate: batch.batchDate,
        plan: recommendation.profiles[profile.id]
      }))
    );
    const publishedPlans = datedPlans
      .map(({ plan }) => plan)
      .filter(isRecommendedPlan);
    const closedPlans = publishedPlans.filter((plan) => isClosedResult(plan.outcome.result));
    const successful = closedPlans.filter((plan) => isSuccessfulResult(plan.outcome.result)).length;
    const benchmarkReturns = closedPlans
      .map((plan) => plan.outcome.benchmarkReturnPct)
      .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
    const benchmarkReturnPct = benchmarkReturns.length ? average(benchmarkReturns) : null;
    const averageReturnPct = average(closedPlans.map((plan) => plan.outcome.returnPct));

    return {
      horizon: profile.id,
      label: profile.label || HORIZON_LABELS[profile.id],
      total: publishedPlans.length,
      closed: closedPlans.length,
      open: publishedPlans.length - closedPlans.length,
      hitRate: closedPlans.length ? roundMetric((successful / closedPlans.length) * 100) : null,
      averageReturnPct,
      maxDrawdownPct: maxDrawdown(datedPlans),
      averageHoldingDays: average(closedPlans.map((plan) => plan.outcome.holdingDays)),
      benchmarkReturnPct,
      benchmarkCoverage: benchmarkReturns.length,
      alphaPct:
        averageReturnPct !== null && benchmarkReturnPct !== null
          ? roundMetric(averageReturnPct - benchmarkReturnPct)
          : null,
      confidenceCalibration: buildConfidenceCalibration(publishedPlans, profile.id)
    };
  });

  return {
    generatedAt: dataset.currentBatch.generatedAt,
    batchCount: dataset.history.length,
    benchmarkLabel: "Nifty 50 where generated history includes benchmark returns",
    horizons
  };
}

export function buildStockPerformanceHistory(
  history: HistoricalBatch[],
  symbol: string,
  horizon: HorizonId
): StockPerformanceHistoryEntry[] {
  return [...history]
    .sort((left, right) => right.batchDate.localeCompare(left.batchDate))
    .flatMap((batch) =>
      batch.recommendations
        .filter((recommendation) => recommendation.symbol === symbol)
        .filter((recommendation) => isRecommendedPlan(recommendation.profiles[horizon]))
        .map((recommendation) => ({
          batchDate: batch.batchDate,
          publishedAt: batch.publishedAt,
          symbol: recommendation.symbol,
          companyName: recommendation.companyName,
          sector: recommendation.sector,
          horizon,
          conviction: recommendation.profiles[horizon].conviction,
          entryPrice: recommendation.profiles[horizon].entryPrice,
          targetPrice: recommendation.profiles[horizon].targetPrice,
          stopLoss: recommendation.profiles[horizon].stopLoss,
          summary: recommendation.profiles[horizon].summary,
          outcome: recommendation.profiles[horizon].outcome
        }))
    );
}

export function outcomeLabel(result: OutcomeResult) {
  switch (result) {
    case "target_hit":
      return "Target hit";
    case "stop_loss_hit":
      return "Stop-loss hit";
    default:
      return "Open";
  }
}

export function outcomeClass(result: OutcomeResult) {
  switch (result) {
    case "target_hit":
      return "success";
    case "stop_loss_hit":
      return "danger";
    default:
      return "neutral";
  }
}
