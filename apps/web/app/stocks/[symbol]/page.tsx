import { StockDetail } from "@/components/stock-detail";
import type { SearchAnalysisResult } from "@/lib/types";
import {
  analyzeSearchSymbolWithTimeout,
  compactStockDetailDataset,
  loadRecommendationData
} from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type StockPageProps = {
  params: Promise<{
    symbol: string;
  }>;
};

export default async function StockPage({ params }: StockPageProps) {
  const routeParams = await params;
  const symbol = typeof routeParams.symbol === "string" ? routeParams.symbol : "";
  const dataset = await loadRecommendationData();
  const analysis: SearchAnalysisResult | null = symbol
    ? await analyzeSearchSymbolWithTimeout(symbol, dataset)
    : null;
  const detailDataset = compactStockDetailDataset(dataset, symbol, analysis?.stock);
  const displayAnalysis = analysis
    ? {
        ...analysis,
        stock: null
      }
    : null;

  return <StockDetail data={detailDataset} analysis={displayAnalysis} requestedSymbol={symbol} />;
}
