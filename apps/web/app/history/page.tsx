import { HistoryDashboard } from "@/components/history-dashboard";
import { loadRecommendationData } from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const dataset = await loadRecommendationData();

  return <HistoryDashboard data={dataset} />;
}
