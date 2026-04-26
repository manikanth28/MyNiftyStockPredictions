import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { loadRecommendationData } from "@/lib/recommendation-data";
import type { HorizonId } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    symbol?: string;
    horizon?: string;
  }>;
};

const HORIZON_IDS = new Set<HorizonId>(["single_day", "swing", "position", "long_term"]);

function normalizeHorizon(value: string | undefined): HorizonId | undefined {
  return value && HORIZON_IDS.has(value as HorizonId) ? (value as HorizonId) : undefined;
}

export default async function PortfolioPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const dataset = await loadRecommendationData();

  return (
    <PortfolioDashboard
      data={dataset}
      initialHorizon={normalizeHorizon(params.horizon)}
      initialSymbol={params.symbol}
    />
  );
}
