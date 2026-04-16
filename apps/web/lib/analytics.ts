import type {
  DailyPerformance,
  HistoricalBatch,
  HistoricalRecommendationPlan,
  HorizonId,
  OutcomeResult,
  RecommendationDataset,
  StockPerformanceHistoryEntry
} from "@/lib/types";

const CLOSED_RESULTS: OutcomeResult[] = ["target_hit", "stop_loss_hit"];

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
