import { Dashboard, type DashboardArchiveSummary } from "@/components/dashboard";
import { buildDailyPerformance, buildPerformanceSummary } from "@/lib/analytics";
import type { HorizonId, RecommendationDataset, SearchAnalysisResult } from "@/lib/types";
import {
  analyzeSearchSymbolWithTimeout,
  compactDashboardDataset,
  compactSearchAnalysisResult,
  loadRecommendationData
} from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    symbol?: string;
  }>;
};

const HORIZONS: HorizonId[] = ["single_day", "swing", "position", "long_term"];

function buildDashboardArchiveSummary(dataset: RecommendationDataset): DashboardArchiveSummary {
  const byHorizon = HORIZONS.reduce<DashboardArchiveSummary["byHorizon"]>((summary, horizon) => {
    const dailyPerformance = buildDailyPerformance(dataset.history, horizon);
    const performanceSummary = buildPerformanceSummary(dailyPerformance);

    summary[horizon] = {
      averageClosedReturnPct: performanceSummary.averageClosedReturnPct,
      averageSuccessRate: performanceSummary.averageSuccessRate,
      latestCompletedBatchDate: performanceSummary.latestCompleted?.batchDate ?? null,
      latestCompletedSuccessRate: performanceSummary.latestCompleted?.successRate ?? null
    };

    return summary;
  }, {} as DashboardArchiveSummary["byHorizon"]);

  return {
    historyCount: dataset.history.length,
    byHorizon
  };
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = typeof params.symbol === "string" ? params.symbol : "";
  const dataset = await loadRecommendationData();
  const searchedAnalysis: SearchAnalysisResult | null = query
    ? await analyzeSearchSymbolWithTimeout(query, dataset)
    : null;

  return (
    <Dashboard
      archiveSummary={buildDashboardArchiveSummary(dataset)}
      data={compactDashboardDataset(dataset)}
      searchedAnalysis={compactSearchAnalysisResult(searchedAnalysis)}
    />
  );
}
