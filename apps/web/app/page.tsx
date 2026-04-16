import { Dashboard } from "@/components/dashboard";
import type { SearchAnalysisResult } from "@/lib/types";
import { analyzeSearchSymbolWithTimeout, loadRecommendationData } from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    symbol?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const query = typeof params.symbol === "string" ? params.symbol : "";
  const dataset = await loadRecommendationData();
  const searchedAnalysis: SearchAnalysisResult | null = query
    ? await analyzeSearchSymbolWithTimeout(query, dataset)
    : null;

  return <Dashboard data={dataset} searchedAnalysis={searchedAnalysis} />;
}
