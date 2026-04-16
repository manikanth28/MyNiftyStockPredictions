"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  InfoTooltip,
  compactUniverseLabel,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPrice,
  isRecommendedPlan,
  priceMoveMeta
} from "@/components/market-ui";
import { StockSearchBox } from "@/components/stock-search-box";
import { useLatestPriceOverlay } from "@/components/use-latest-price-overlay";
import { buildDailyPerformance, buildPerformanceSummary } from "@/lib/analytics";
import type {
  HorizonId,
  RecommendationDataset,
  RecommendationPlan,
  SearchAnalysisResult,
  StockAnalysis
} from "@/lib/types";

type DashboardProps = {
  data: RecommendationDataset;
  searchedAnalysis: SearchAnalysisResult | null;
};

type SignalState = "consider" | "watch" | "avoid";
type Tone = "success" | "warning" | "danger" | "neutral";
type SortKey =
  | "stock"
  | "sector"
  | "signal"
  | "score"
  | "suggested"
  | "now"
  | "target"
  | "stop"
  | "riskReward"
  | "return"
  | "action";
type SortDirection = "asc" | "desc";

const SIGNAL_SORT_RANK: Record<SignalState, number> = {
  consider: 0,
  watch: 1,
  avoid: 2
};

const HORIZON_THRESHOLDS: Record<HorizonId, number> = {
  single_day: 54,
  swing: 56,
  position: 58,
  long_term: 60
};

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, value));
}

function planScore(plan: RecommendationPlan) {
  return plan.score ?? plan.expectedReturnPct;
}

function signalStateFor(plan: RecommendationPlan, horizon: HorizonId): SignalState {
  const threshold = HORIZON_THRESHOLDS[horizon];
  const score = plan.score ?? 0;

  if (isRecommendedPlan(plan) && score >= threshold) {
    return "consider";
  }

  if (score >= threshold - 8 || plan.riskReward >= 1.2) {
    return "watch";
  }

  return "avoid";
}

function signalLabel(state: SignalState) {
  switch (state) {
    case "consider":
      return "Tradable";
    case "watch":
      return "Wait";
    default:
      return "Avoid";
  }
}

function actionLabel(state: SignalState, profileLabel: string) {
  switch (state) {
    case "consider":
      return `Buy (${profileLabel})`;
    case "watch":
      return "Wait for confirmation";
    default:
      return "View Analysis";
  }
}

function tableActionLabel(state: SignalState) {
  switch (state) {
    case "consider":
      return "Buy";
    case "watch":
      return "Wait";
    default:
      return "Open";
  }
}

function tableConfidenceLabel(label: string) {
  switch (label) {
    case "High Probability Trade":
      return "High Prob.";
    default:
      return label;
  }
}

function tablePriceMoveLabel(deltaPct: number | null) {
  if (deltaPct === null || !Number.isFinite(deltaPct)) {
    return "n/a";
  }

  if (Math.abs(deltaPct) < 0.05) {
    return "0.00%";
  }

  return `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(2)}%`;
}

function defaultSortDirection(sortKey: SortKey): SortDirection {
  switch (sortKey) {
    case "score":
    case "riskReward":
    case "return":
      return "desc";
    default:
      return "asc";
  }
}

function compareNullableNumber(left: number | null, right: number | null, direction: SortDirection) {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc" ? left - right : right - left;
}

function compareText(left: string, right: string, direction: SortDirection) {
  const result = left.localeCompare(right, undefined, { sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function sortIndicator(sortKey: SortKey, activeSortKey: SortKey, sortDirection: SortDirection) {
  if (sortKey !== activeSortKey) {
    return "↕";
  }

  return sortDirection === "asc" ? "↑" : "↓";
}

function SortHeader({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onToggle
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  sortDirection: SortDirection;
  onToggle: (sortKey: SortKey) => void;
}) {
  const active = sortKey === activeSortKey;

  return (
    <th scope="col">
      <button
        className={`dashboard-sort-header${active ? " active" : ""}`}
        onClick={() => onToggle(sortKey)}
        type="button"
      >
        <span>{label}</span>
        <span className="dashboard-sort-indicator" aria-hidden="true">
          {sortIndicator(sortKey, activeSortKey, sortDirection)}
        </span>
      </button>
    </th>
  );
}

function sortStocks(
  stocks: StockAnalysis[],
  horizon: HorizonId,
  sortKey: SortKey,
  sortDirection: SortDirection,
  currentPriceFor: (stock: StockAnalysis) => number
) {
  const sortedStocks = [...stocks];

  sortedStocks.sort((left, right) => {
    const leftPlan = left.profiles[horizon];
    const rightPlan = right.profiles[horizon];
    const leftState = signalStateFor(leftPlan, horizon);
    const rightState = signalStateFor(rightPlan, horizon);
    let comparison = 0;

    switch (sortKey) {
      case "stock":
        comparison = compareText(left.companyName, right.companyName, sortDirection);
        break;
      case "sector":
        comparison = compareText(left.sector, right.sector, sortDirection);
        break;
      case "signal":
        comparison = compareNullableNumber(
          SIGNAL_SORT_RANK[leftState],
          SIGNAL_SORT_RANK[rightState],
          sortDirection
        );
        break;
      case "score":
        comparison = compareNullableNumber(leftPlan.score ?? 0, rightPlan.score ?? 0, sortDirection);
        break;
      case "suggested":
        comparison = compareNullableNumber(leftPlan.entryPrice, rightPlan.entryPrice, sortDirection);
        break;
      case "now":
        comparison = compareNullableNumber(currentPriceFor(left), currentPriceFor(right), sortDirection);
        break;
      case "target":
        comparison = compareNullableNumber(leftPlan.targetPrice, rightPlan.targetPrice, sortDirection);
        break;
      case "stop":
        comparison = compareNullableNumber(leftPlan.stopLoss, rightPlan.stopLoss, sortDirection);
        break;
      case "riskReward":
        comparison = compareNullableNumber(leftPlan.riskReward, rightPlan.riskReward, sortDirection);
        break;
      case "return":
        comparison = compareNullableNumber(leftPlan.expectedReturnPct, rightPlan.expectedReturnPct, sortDirection);
        break;
      case "action":
        comparison = compareNullableNumber(
          SIGNAL_SORT_RANK[leftState],
          SIGNAL_SORT_RANK[rightState],
          sortDirection
        );
        break;
    }

    if (comparison !== 0) {
      return comparison;
    }

    return compareText(left.companyName, right.companyName, "asc");
  });

  return sortedStocks;
}

function confidenceMeta(plan: RecommendationPlan, horizon: HorizonId) {
  const threshold = HORIZON_THRESHOLDS[horizon];
  const score = plan.score ?? 0;

  if (score >= threshold + 12) {
    return {
      label: "High Probability Trade",
      tone: "success" as Tone,
      progress: clampProgress(score),
      threshold
    };
  }

  if (score >= threshold) {
    return {
      label: "Tradable",
      tone: "success" as Tone,
      progress: clampProgress(score),
      threshold
    };
  }

  if (score >= threshold - 8) {
    return {
      label: "Wait",
      tone: "warning" as Tone,
      progress: clampProgress(score),
      threshold
    };
  }

  return {
    label: "Avoid",
    tone: "danger" as Tone,
    progress: clampProgress(score),
    threshold
  };
}

function riskRewardMeta(value: number) {
  if (value > 1.5) {
    return { tone: "success" as Tone, label: "Good" };
  }

  if (value >= 1) {
    return { tone: "warning" as Tone, label: "Balanced" };
  }

  return { tone: "danger" as Tone, label: "Weak" };
}

function liveStatusMeta(mode?: string) {
  switch (mode) {
    case "live":
      return { tone: "success" as Tone, label: "Live" };
    case "cache":
      return { tone: "warning" as Tone, label: "Cached" };
    case "sample":
      return { tone: "neutral" as Tone, label: "Offline" };
    default:
      return { tone: "neutral" as Tone, label: "Ready" };
  }
}

function ScoreMeter({
  tone,
  progress,
  threshold,
  label
}: {
  tone: Tone;
  progress: number;
  threshold: number;
  label?: string;
}) {
  return (
    <div className="dashboard-score-meter" aria-hidden="true">
      <div className="dashboard-score-track">
        <span
          className={`dashboard-score-fill ${tone}`}
          style={{ width: `${progress}%` }}
        />
        <span className="dashboard-score-threshold" style={{ left: `${threshold}%` }} />
      </div>
      {label ? <span className="dashboard-score-baseline">{label}</span> : null}
    </div>
  );
}

function SearchResultBanner({
  searchedAnalysis,
  stockHref,
  activeHorizon,
  profileLabel,
  currentPrice,
  dayStartPrice
}: {
  searchedAnalysis: SearchAnalysisResult;
  stockHref: string | null;
  activeHorizon: HorizonId;
  profileLabel: string;
  currentPrice: number | null;
  dayStartPrice: number | null;
}) {
  const searchedStock = searchedAnalysis.stock;
  const quickPlan = searchedStock ? searchedStock.profiles[activeHorizon] : null;
  const liveCurrentPrice = currentPrice ?? searchedStock?.currentMarketPrice ?? null;
  const searchCmpMove =
    liveCurrentPrice !== null ? priceMoveMeta(liveCurrentPrice, dayStartPrice, "day start") : null;
  const searchSuggestionMove =
    liveCurrentPrice !== null && quickPlan ? priceMoveMeta(liveCurrentPrice, quickPlan.entryPrice) : null;
  const searchedState =
    searchedAnalysis.status === "analyzed" && quickPlan
      ? signalStateFor(quickPlan, activeHorizon)
      : "watch";
  const searchTone =
    searchedAnalysis.status !== "analyzed"
      ? "neutral"
      : searchedAnalysis.shouldConsider
        ? "consider"
        : "avoid";

  return (
    <section className={`dashboard-search-banner ${searchTone}`}>
      <div className="dashboard-search-banner-copy">
        <span className="dashboard-mini-label">Search verdict</span>
        <div className="dashboard-search-banner-top">
          <h2>
            {searchedStock ? `${searchedStock.companyName} (${searchedStock.symbol})` : searchedAnalysis.query}
          </h2>
          <span className={`dashboard-signal-badge ${searchedState}`}>
            <span className="dashboard-signal-dot" />
            {searchedAnalysis.status === "analyzed"
              ? signalLabel(searchedState)
              : searchedAnalysis.status === "not_found"
                ? "Not found"
                : "Unavailable"}
          </span>
        </div>
        <p>{searchedAnalysis.verdict}</p>
        {searchedStock ? (
          <div className="dashboard-search-banner-meta">
            <span>{searchedStock.sector}</span>
            <span>CMP {formatPrice(liveCurrentPrice ?? searchedStock.currentMarketPrice)}</span>
            {quickPlan ? <span>Suggested at {formatPrice(quickPlan.entryPrice)}</span> : null}
            {searchCmpMove ? (
              <span className={`dashboard-inline-trend ${searchCmpMove.tone}`}>{searchCmpMove.move}</span>
            ) : null}
            {searchSuggestionMove ? (
              <span className="dashboard-price-caption">{searchSuggestionMove.note}</span>
            ) : null}
            <span>{quickPlan?.score?.toFixed(1) ?? "n/a"} / 100</span>
            <span>{profileLabel}</span>
          </div>
        ) : null}
      </div>

      {stockHref ? (
        <div className="dashboard-search-banner-actions">
          <Link className="dashboard-row-action secondary" href={stockHref}>
            Open stock
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function StockTableRow({
  stock,
  plan,
  activeHorizon,
  profileLabel,
  isSelected,
  currentPrice,
  dayStartPrice,
  onSelect
}: {
  stock: StockAnalysis;
  plan: RecommendationPlan;
  activeHorizon: HorizonId;
  profileLabel: string;
  isSelected: boolean;
  currentPrice: number;
  dayStartPrice: number | null;
  onSelect: () => void;
}) {
  const state = signalStateFor(plan, activeHorizon);
  const confidence = confidenceMeta(plan, activeHorizon);
  const riskReward = riskRewardMeta(plan.riskReward);
  const suggestionMove = priceMoveMeta(currentPrice, plan.entryPrice);
  const cmpMove = priceMoveMeta(currentPrice, dayStartPrice, "day start");
  const stockHref = `/stocks/${stock.symbol}`;
  const rowActionLabel = actionLabel(state, profileLabel);
  const rowMoveLabel = tablePriceMoveLabel(cmpMove.deltaPct);

  return (
    <tr
      aria-label={`Select ${stock.companyName}`}
      aria-pressed={isSelected}
      className={`dashboard-stock-row ${state}${isSelected ? " selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <td className="dashboard-stock-cell dashboard-stock-identity">
        <div className="dashboard-stock-identity-line">
          <Link
            className="dashboard-stock-open"
            href={stockHref}
            onClick={(event) => event.stopPropagation()}
            title={stock.companyName}
          >
            {stock.companyName}
          </Link>
          <span className="dashboard-stock-symbol" title={stock.symbol}>
            {stock.symbol}
          </span>
        </div>
      </td>

      <td className="dashboard-stock-cell">
        <span>{stock.sector}</span>
      </td>

      <td className="dashboard-stock-cell">
        <span className={`dashboard-signal-badge ${state}`}>
          <span className="dashboard-signal-dot" />
          {signalLabel(state)}
        </span>
      </td>

      <td className="dashboard-stock-cell">
        <div className="dashboard-table-score dashboard-table-score-inline" title={confidence.label}>
          <div className="dashboard-table-score-value">{(plan.score ?? 0).toFixed(1)} / 100</div>
          <div className={`dashboard-table-score-note ${confidence.tone}`}>
            {tableConfidenceLabel(confidence.label)}
          </div>
        </div>
      </td>

      <td className="dashboard-stock-cell">
        <div className="dashboard-price-stack dashboard-price-stack-inline">
          <strong>{formatPrice(plan.entryPrice)}</strong>
          <span className={`dashboard-inline-trend ${suggestionMove.tone}`}>{suggestionMove.move}</span>
        </div>
      </td>

      <td className="dashboard-stock-cell">
        <div className="dashboard-price-stack dashboard-price-stack-inline">
          <strong>{formatPrice(currentPrice)}</strong>
          <span className={`dashboard-inline-trend ${cmpMove.tone}`} title={cmpMove.label}>
            {rowMoveLabel}
          </span>
        </div>
      </td>

      <td className="dashboard-stock-cell target">
        <strong>{formatPrice(plan.targetPrice)}</strong>
      </td>

      <td className="dashboard-stock-cell stop">
        <strong>{formatPrice(plan.stopLoss)}</strong>
      </td>

      <td className="dashboard-stock-cell">
        <div className={`dashboard-rr-badge ${riskReward.tone}`}>
          {plan.riskReward.toFixed(2)} - {riskReward.label}
        </div>
      </td>

      <td className="dashboard-stock-cell">
        <span className="dashboard-return-value">{formatPercent(plan.expectedReturnPct)}</span>
      </td>

      <td className="dashboard-stock-cell dashboard-stock-action">
        <Link
          className={`dashboard-row-action ${state}`}
          href={stockHref}
          onClick={(event) => event.stopPropagation()}
          title={rowActionLabel}
        >
          {tableActionLabel(state)}
        </Link>
      </td>
    </tr>
  );
}

function StockTable({
  stocks,
  activeHorizon,
  profileLabel,
  sortKey,
  sortDirection,
  onToggleSort,
  selectedSymbol,
  currentPriceFor,
  dayStartPriceFor,
  onSelectSymbol
}: {
  stocks: StockAnalysis[];
  activeHorizon: HorizonId;
  profileLabel: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onToggleSort: (sortKey: SortKey) => void;
  selectedSymbol: string | null;
  currentPriceFor: (stock: StockAnalysis) => number;
  dayStartPriceFor: (stock: StockAnalysis) => number | null;
  onSelectSymbol: (symbol: string) => void;
}) {
  return (
    <div className="dashboard-table-scroll">
      <table className="dashboard-stock-table">
        <colgroup>
          <col className="dashboard-col-stock" />
          <col className="dashboard-col-sector" />
          <col className="dashboard-col-signal" />
          <col className="dashboard-col-score" />
          <col className="dashboard-col-suggested" />
          <col className="dashboard-col-now" />
          <col className="dashboard-col-target" />
          <col className="dashboard-col-stop" />
          <col className="dashboard-col-rr" />
          <col className="dashboard-col-return" />
          <col className="dashboard-col-action" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader
              label="Stock"
              sortKey="stock"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Sector"
              sortKey="sector"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Signal"
              sortKey="signal"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Score"
              sortKey="score"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Suggested at"
              sortKey="suggested"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Now"
              sortKey="now"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Target"
              sortKey="target"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Stop-loss"
              sortKey="stop"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Risk / Reward"
              sortKey="riskReward"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Return"
              sortKey="return"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
            <SortHeader
              label="Action"
              sortKey="action"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onToggle={onToggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock) => (
            <StockTableRow
              key={`${activeHorizon}-${stock.symbol}`}
              stock={stock}
              plan={stock.profiles[activeHorizon]}
              activeHorizon={activeHorizon}
              profileLabel={profileLabel}
              isSelected={selectedSymbol === stock.symbol}
              currentPrice={currentPriceFor(stock)}
              dayStartPrice={dayStartPriceFor(stock)}
              onSelect={() => onSelectSymbol(stock.symbol)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard({ data, searchedAnalysis }: DashboardProps) {
  const [activeHorizon, setActiveHorizon] = useState<HorizonId>(data.profiles[0]?.id ?? "single_day");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const targetVisibleIdeas = 10;
  const toggleSort = (nextSortKey: SortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(defaultSortDirection(nextSortKey));
  };

  useEffect(() => {
    if (!data.profiles.some((profile) => profile.id === activeHorizon)) {
      setActiveHorizon(data.profiles[0]?.id ?? "single_day");
    }
  }, [activeHorizon, data.profiles]);

  const activeProfile = data.profiles.find((profile) => profile.id === activeHorizon) ?? data.profiles[0];
  const profileLabel = activeProfile?.label ?? "Single-day";
  const sourceProvider = data.dataSource?.provider ?? "Live recommendation loader";
  const watchlistName = compactUniverseLabel(data.universe);
  const liveStatus = liveStatusMeta(data.dataSource?.mode);

  const localSearchSuggestions = useMemo(
    () =>
      data.currentBatch.recommendations.map((stock) => ({
        symbol: stock.symbol,
        companyName: stock.companyName,
        sector: stock.sector,
        industry: stock.industry
      })),
    [data.currentBatch.recommendations]
  );

  const recommendationBuckets = useMemo(() => {
    const sorted = [...data.currentBatch.recommendations].sort(
      (left, right) => planScore(right.profiles[activeHorizon]) - planScore(left.profiles[activeHorizon])
    );
    const tradableRecommendations = sorted.filter(
      (stock) => signalStateFor(stock.profiles[activeHorizon], activeHorizon) === "consider"
    );
    const watchRecommendations = sorted.filter(
      (stock) => signalStateFor(stock.profiles[activeHorizon], activeHorizon) === "watch"
    );

    return {
      visibleRecommendations: tradableRecommendations.slice(0, targetVisibleIdeas),
      visibleWatchlist: watchRecommendations.slice(0, targetVisibleIdeas),
      tradableCount: tradableRecommendations.length,
      watchCount: watchRecommendations.length
    };
  }, [activeHorizon, data.currentBatch.recommendations]);
  const tradableShortlistRecommendations = recommendationBuckets.visibleRecommendations;
  const watchShortlistRecommendations = recommendationBuckets.visibleWatchlist;
  const overlaySymbols = useMemo(
    () =>
      [
        ...new Set([
          searchedAnalysis?.stock?.symbol,
          ...tradableShortlistRecommendations.map((stock) => stock.symbol),
          ...watchShortlistRecommendations.map((stock) => stock.symbol)
        ])
      ].filter((value): value is string => Boolean(value)),
    [searchedAnalysis?.stock?.symbol, tradableShortlistRecommendations, watchShortlistRecommendations]
  );
  const livePriceOverlay = useLatestPriceOverlay(overlaySymbols);
  const overlayEntryFor = (stock: StockAnalysis) => livePriceOverlay[stock.symbol] ?? null;
  const currentPriceFor = (stock: StockAnalysis) =>
    overlayEntryFor(stock)?.currentMarketPrice ?? stock.currentMarketPrice;
  const dayStartPriceFor = (stock: StockAnalysis) => overlayEntryFor(stock)?.dayStartPrice ?? null;
  const visibleRecommendations = useMemo(() => {
    return sortStocks(
      tradableShortlistRecommendations,
      activeHorizon,
      sortKey,
      sortDirection,
      currentPriceFor
    );
  }, [activeHorizon, livePriceOverlay, sortDirection, sortKey, tradableShortlistRecommendations]);
  const visibleWatchlist = useMemo(() => {
    return sortStocks(
      watchShortlistRecommendations,
      activeHorizon,
      sortKey,
      sortDirection,
      currentPriceFor
    );
  }, [activeHorizon, livePriceOverlay, sortDirection, sortKey, watchShortlistRecommendations]);
  const displayedRecommendations = visibleRecommendations.length ? visibleRecommendations : visibleWatchlist;
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(displayedRecommendations[0]?.symbol ?? null);

  useEffect(() => {
    if (!displayedRecommendations.length) {
      setSelectedSymbol(null);
      return;
    }

    const searchedSymbol = searchedAnalysis?.stock?.symbol;
    const searchedVisible = searchedSymbol
      ? displayedRecommendations.find((stock) => stock.symbol === searchedSymbol)?.symbol
      : null;

    if (!selectedSymbol || !displayedRecommendations.some((stock) => stock.symbol === selectedSymbol)) {
      setSelectedSymbol(searchedVisible ?? displayedRecommendations[0].symbol);
    }
  }, [displayedRecommendations, searchedAnalysis?.stock?.symbol, selectedSymbol]);
  const searchedCurrentPrice = searchedAnalysis?.stock ? currentPriceFor(searchedAnalysis.stock) : null;
  const searchedDayStartPrice = searchedAnalysis?.stock ? dayStartPriceFor(searchedAnalysis.stock) : null;

  const dailyPerformance = useMemo(
    () => buildDailyPerformance(data.history, activeHorizon),
    [activeHorizon, data.history]
  );
  const performanceSummary = useMemo(
    () => buildPerformanceSummary(dailyPerformance),
    [dailyPerformance]
  );

  const spotlightStock =
    displayedRecommendations.find((stock) => stock.symbol === selectedSymbol) ?? displayedRecommendations[0];
  const spotlightPlan = spotlightStock?.profiles[activeHorizon];
  const spotlightCurrentPrice = spotlightStock ? currentPriceFor(spotlightStock) : null;
  const spotlightDayStartPrice = spotlightStock ? dayStartPriceFor(spotlightStock) : null;
  const spotlightConfidence = spotlightPlan ? confidenceMeta(spotlightPlan, activeHorizon) : null;
  const spotlightSuggestionMove =
    spotlightStock && spotlightPlan && spotlightCurrentPrice !== null
      ? priceMoveMeta(spotlightCurrentPrice, spotlightPlan.entryPrice)
      : null;
  const spotlightCmpMove =
    spotlightStock && spotlightCurrentPrice !== null
      ? priceMoveMeta(spotlightCurrentPrice, spotlightDayStartPrice, "day start")
      : null;
  const spotlightRisk = spotlightPlan ? riskRewardMeta(spotlightPlan.riskReward) : null;

  const recommendedCount = recommendationBuckets.tradableCount;
  const watchCount = recommendationBuckets.watchCount;

  const quickSearchSymbols = useMemo(() => {
    const items = [
      searchedAnalysis?.stock?.symbol,
      ...displayedRecommendations.slice(0, 4).map((stock) => stock.symbol)
    ].filter((value): value is string => Boolean(value));

    return [...new Set(items)].slice(0, 5);
  }, [displayedRecommendations, searchedAnalysis?.stock?.symbol]);

  const contextItems = [
    { label: "Exchange", value: data.exchange },
    { label: "Universe", value: watchlistName },
    { label: "Horizon", value: profileLabel },
    { label: "Data source", value: sourceProvider },
    { label: "Last updated", value: formatDateTime(data.currentBatch.generatedAt) },
    { label: "Status", value: liveStatus.label, tone: liveStatus.tone }
  ];

  const overviewCards = [
    {
      icon: "EX",
      label: "Exchange",
      tooltip: "The active market being screened in this dashboard.",
      value: data.exchange,
      footnote: watchlistName
    },
    {
      icon: "HZ",
      label: "Active horizon",
      tooltip: "The recommendation window controlling score thresholds and trade plans.",
      value: profileLabel,
      footnote: activeProfile?.window ?? "Model profile"
    },
    {
      icon: "WL",
      label: "Tradable ideas",
      tooltip: "Only names that cleared the tradable threshold count as live recommendations.",
      value: formatNumber(recommendedCount),
      footnote: watchCount
        ? `${formatNumber(watchCount)} setups waiting for confirmation`
        : "No waiting setups in this batch"
    },
    {
      icon: "AN",
      label: "Analyzed stocks",
      tooltip: "Names processed in the current recommendation batch.",
      value: formatNumber(data.currentBatch.recommendations.length),
      footnote: data.currentBatch.batchDate
    },
    {
      icon: "AR",
      label: "Avg return",
      tooltip: "Average return across completed recommendation batches.",
      value: formatPercent(performanceSummary.averageClosedReturnPct),
      footnote: `Success ${formatPercent(performanceSummary.averageSuccessRate)}`
    }
  ];

  const archiveSuccessRate = performanceSummary.latestCompleted?.successRate ?? performanceSummary.averageSuccessRate;
  const archiveReturn = performanceSummary.averageClosedReturnPct;
  const latestCompletedDate = performanceSummary.latestCompleted?.batchDate
    ? formatDate(performanceSummary.latestCompleted.batchDate)
    : "No closed batch yet";

  return (
    <main className="shell dashboard-redesign-shell">
      <section className="dashboard-context-bar" aria-label="Active dashboard context">
        {contextItems.map((item) => (
          <div className="dashboard-context-item" key={item.label}>
            <span className="dashboard-context-label">{item.label}</span>
            <strong className={item.tone ? `dashboard-context-value ${item.tone}` : "dashboard-context-value"}>
              {item.value}
            </strong>
          </div>
        ))}
      </section>

      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-mini-label">NSE equities workspace</span>
          <h1>Scan ideas, compare trade plans, and act fast.</h1>
          <p>
            Search a stock first, then use the table to compare score, price levels, and risk/reward in
            one pass.
          </p>
        </div>

        <div className="dashboard-search-zone">
          <StockSearchBox
            initialQuery={searchedAnalysis?.query ?? ""}
            localSuggestions={localSearchSuggestions}
          />

          <div className="dashboard-quick-searches" aria-label="Quick stock lookups">
            <span className="dashboard-quick-search-label">Quick lookups</span>
            <div className="dashboard-quick-search-list">
              {quickSearchSymbols.map((symbol) => (
                <Link key={symbol} className="dashboard-quick-search-chip" href={`/?symbol=${symbol}`}>
                  {symbol}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {searchedAnalysis ? (
          <SearchResultBanner
            searchedAnalysis={searchedAnalysis}
            stockHref={searchedAnalysis.stock ? `/stocks/${searchedAnalysis.stock.symbol}` : null}
            activeHorizon={activeHorizon}
            profileLabel={profileLabel}
            currentPrice={searchedCurrentPrice}
            dayStartPrice={searchedDayStartPrice}
          />
        ) : null}
      </section>

      <section className="dashboard-kpi-strip" aria-label="Market KPI strip">
        {overviewCards.map((card) => (
          <article className="dashboard-kpi-card" key={card.label}>
            <div className="dashboard-kpi-top">
              <span className="dashboard-kpi-icon" aria-hidden="true">
                {card.icon}
              </span>
              <span className="dashboard-kpi-label">
                {card.label}
                <InfoTooltip content={card.tooltip} />
              </span>
            </div>
            <strong className="dashboard-kpi-value">{card.value}</strong>
            <span className="dashboard-kpi-footnote">{card.footnote}</span>
          </article>
        ))}
      </section>

      <section className="dashboard-main-grid">
        <section className="dashboard-table-panel">
          <div className="dashboard-section-head">
            <div>
              <span className="dashboard-mini-label">Live shortlist</span>
              <h2>Today&apos;s ranked ideas</h2>
            </div>

            <div className="dashboard-horizon-pills" role="tablist" aria-label="Recommendation horizon">
              {data.profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={`dashboard-horizon-pill${profile.id === activeHorizon ? " active" : ""}`}
                  onClick={() => setActiveHorizon(profile.id)}
                  type="button"
                >
                  {profile.label}
                </button>
              ))}
            </div>
          </div>

          <div className="dashboard-table-stack">
            <section className="dashboard-table-section">
              <div className="dashboard-table-subhead">
                <div>
                  <span className="dashboard-mini-label">Tradable recommendations</span>
                  <h3>Only live calls are listed here</h3>
                </div>
                <span className="dashboard-table-count">{formatNumber(recommendedCount)} tradable</span>
              </div>

              <div className="dashboard-table-card">
                {visibleRecommendations.length ? (
                  <StockTable
                    stocks={visibleRecommendations}
                    activeHorizon={activeHorizon}
                    profileLabel={profileLabel}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onToggleSort={toggleSort}
                    selectedSymbol={selectedSymbol}
                    currentPriceFor={currentPriceFor}
                    dayStartPriceFor={dayStartPriceFor}
                    onSelectSymbol={setSelectedSymbol}
                  />
                ) : (
                  <div className="empty-state">
                    No tradable recommendations cleared the current horizon threshold in this batch.
                  </div>
                )}
              </div>
            </section>

            {visibleWatchlist.length ? (
              <section className="dashboard-table-section">
                <div className="dashboard-table-subhead">
                  <div>
                    <span className="dashboard-mini-label">Needs confirmation</span>
                    <h3>Wait for confirmation before treating these as live calls</h3>
                  </div>
                  <span className="dashboard-table-count">{formatNumber(watchCount)} waiting</span>
                </div>

                <div className="dashboard-table-card">
                  <StockTable
                    stocks={visibleWatchlist}
                    activeHorizon={activeHorizon}
                    profileLabel={profileLabel}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onToggleSort={toggleSort}
                    selectedSymbol={selectedSymbol}
                    currentPriceFor={currentPriceFor}
                    dayStartPriceFor={dayStartPriceFor}
                    onSelectSymbol={setSelectedSymbol}
                  />
                </div>
              </section>
            ) : null}
          </div>
        </section>

        <aside className="dashboard-sidebar">
          {spotlightStock && spotlightPlan && spotlightConfidence && spotlightRisk ? (
            <section className="dashboard-side-panel dashboard-side-panel-primary" key={`${activeHorizon}-${spotlightStock.symbol}`}>
              <div className="dashboard-side-head">
                <span className="dashboard-mini-label">Selected stock</span>
                <h3>{spotlightStock.companyName}</h3>
                <p>
                  {spotlightStock.symbol} · {spotlightStock.sector} ·{" "}
                  {formatPrice(spotlightCurrentPrice ?? spotlightStock.currentMarketPrice)}{" "}
                  {spotlightCmpMove ? (
                    <span className={`dashboard-inline-trend ${spotlightCmpMove.tone}`}>
                      {spotlightCmpMove.move}
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="dashboard-side-score">
                <div className="dashboard-side-score-top">
                  <strong>{(spotlightPlan.score ?? 0).toFixed(1)} / 100</strong>
                  <span className={`dashboard-confidence-chip ${spotlightConfidence.tone}`}>
                    {spotlightConfidence.label}
                  </span>
                </div>
                <ScoreMeter
                  tone={spotlightConfidence.tone}
                  progress={spotlightConfidence.progress}
                  threshold={spotlightConfidence.threshold}
                  label={`Threshold ${spotlightConfidence.threshold}`}
                />
              </div>

              <div className="dashboard-price-ladder">
                <div className="dashboard-price-ladder-row target">
                  <span>Target</span>
                  <strong>{formatPrice(spotlightPlan.targetPrice)}</strong>
                </div>
                <div className="dashboard-price-ladder-row entry">
                  <span>Suggested at</span>
                  <div className="dashboard-price-ladder-value">
                    <strong>{formatPrice(spotlightPlan.entryPrice)}</strong>
                    {spotlightSuggestionMove ? (
                      <small className={`dashboard-inline-trend ${spotlightSuggestionMove.tone}`}>
                        {spotlightSuggestionMove.move}
                      </small>
                    ) : null}
                  </div>
                </div>
                <div className="dashboard-price-ladder-row stop">
                  <span>Stop-loss</span>
                  <strong>{formatPrice(spotlightPlan.stopLoss)}</strong>
                </div>
              </div>

              <div className="dashboard-side-grid">
                <div className="dashboard-side-stat">
                  <span>Risk / Reward</span>
                  <strong className={spotlightRisk.tone}>
                    {spotlightPlan.riskReward.toFixed(2)} - {spotlightRisk.label}
                  </strong>
                </div>
                <div className="dashboard-side-stat">
                  <span>Signal</span>
                  <strong>{signalLabel(signalStateFor(spotlightPlan, activeHorizon))}</strong>
                </div>
              </div>

              <div className="dashboard-side-actions">
                <Link
                  className={`dashboard-row-action dashboard-row-action-primary ${signalStateFor(spotlightPlan, activeHorizon)}`}
                  href={`/stocks/${spotlightStock.symbol}`}
                >
                  {actionLabel(signalStateFor(spotlightPlan, activeHorizon), profileLabel)}
                </Link>
                <Link className="dashboard-row-action secondary" href={`/stocks/${spotlightStock.symbol}`}>
                  Open stock
                </Link>
              </div>
            </section>
          ) : null}

          <section className="dashboard-side-panel">
            <div className="dashboard-side-head">
              <span className="dashboard-mini-label">Archive summary</span>
              <h3>Recommendation outcomes</h3>
              <p>Use history to validate what the model has been doing, not just what it says now.</p>
            </div>

            <div className="dashboard-side-grid">
              <div className="dashboard-side-stat">
                <span>Success rate</span>
                <strong>{formatPercent(archiveSuccessRate)}</strong>
              </div>
              <div className="dashboard-side-stat">
                <span>Avg return</span>
                <strong>{formatPercent(archiveReturn)}</strong>
              </div>
              <div className="dashboard-side-stat">
                <span>Batch count</span>
                <strong>{formatNumber(data.history.length)}</strong>
              </div>
              <div className="dashboard-side-stat">
                <span>Latest close</span>
                <strong>{latestCompletedDate}</strong>
              </div>
            </div>

            <Link className="dashboard-row-action secondary" href="/history">
              Open archive
            </Link>
          </section>

          <section className="dashboard-side-panel">
            <div className="dashboard-side-head">
              <span className="dashboard-mini-label">Market context</span>
              <h3>Current batch details</h3>
              <p>Keep the active screening state visible while scanning the shortlist.</p>
            </div>

            <div className="dashboard-context-grid">
              <div className="dashboard-context-row">
                <span>Exchange</span>
                <strong>{data.exchange}</strong>
              </div>
              <div className="dashboard-context-row">
                <span>Horizon</span>
                <strong>{profileLabel}</strong>
              </div>
              <div className="dashboard-context-row">
                <span>Snapshot size</span>
                <strong>{formatNumber(data.currentBatch.recommendations.length)} stocks</strong>
              </div>
              <div className="dashboard-context-row">
                <span>Data source</span>
                <strong>{sourceProvider}</strong>
              </div>
              <div className="dashboard-context-row">
                <span>Batch date</span>
                <strong>{formatDate(data.currentBatch.batchDate)}</strong>
              </div>
              <div className="dashboard-context-row">
                <span>Status</span>
                <strong className={liveStatus.tone}>{liveStatus.label}</strong>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
