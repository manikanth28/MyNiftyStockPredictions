"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPrice,
  isRecommendedPlan
} from "@/components/market-ui";
import {
  buildDailyPerformance,
  buildPerformanceSummary,
  outcomeClass,
  outcomeLabel
} from "@/lib/analytics";
import type {
  DailyPerformance,
  HistoricalRecommendationPlan,
  HistoricalStockRecommendation,
  HorizonId,
  RecommendationDataset
} from "@/lib/types";

type HistoryDashboardProps = {
  data: RecommendationDataset;
};

type UiTone = "success" | "warning" | "danger" | "neutral";
type RangeFilter = "5" | "10" | "all";
type SignalFilter = "all" | "buy" | "watch" | "avoid";
type ScoreFilter = "all" | "60_plus" | "50_59" | "below_50";
type SortKey = "date" | "successRate" | "trades";
type SortDirection = "asc" | "desc";

type ArchiveEntry = {
  batchDate: string;
  publishedAt: string;
  stock: HistoricalStockRecommendation;
  plan: HistoricalRecommendationPlan;
  riskReward: number;
  signal: {
    id: Exclude<SignalFilter, "all">;
    label: string;
    tone: UiTone;
  };
};

const HORIZON_THRESHOLDS: Record<HorizonId, number> = {
  single_day: 54,
  swing: 56,
  position: 58,
  long_term: 60
};

const RANGE_OPTIONS: Array<{ id: RangeFilter; label: string }> = [
  { id: "5", label: "Last 5" },
  { id: "10", label: "Last 10" },
  { id: "all", label: "All" }
];

const SIGNAL_OPTIONS: Array<{ id: SignalFilter; label: string }> = [
  { id: "all", label: "All signals" },
  { id: "buy", label: "Buy" },
  { id: "watch", label: "Wait" },
  { id: "avoid", label: "Avoid" }
];

const SCORE_OPTIONS: Array<{ id: ScoreFilter; label: string }> = [
  { id: "all", label: "All scores" },
  { id: "60_plus", label: "60+" },
  { id: "50_59", label: "50-59" },
  { id: "below_50", label: "Below 50" }
];

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function rangeLimit(range: RangeFilter) {
  switch (range) {
    case "5":
      return 5;
    case "10":
      return 10;
    default:
      return null;
  }
}

function rangeLabel(range: RangeFilter, visibleRows: number) {
  switch (range) {
    case "5":
      return `Last 5 sessions (${visibleRows})`;
    case "10":
      return `Last 10 sessions (${visibleRows})`;
    default:
      return `Full archive (${visibleRows})`;
  }
}

function firstSentence(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/.+?[.!?](?:\s|$)/);
  return (match?.[0] ?? normalized).trim();
}

function shorten(text: string, maxLength = 132) {
  const normalized = firstSentence(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function planScore(plan: HistoricalRecommendationPlan) {
  return plan.score ?? 0;
}

function planRiskReward(plan: HistoricalRecommendationPlan) {
  return roundMetric((plan.targetPrice - plan.entryPrice) / Math.max(plan.entryPrice - plan.stopLoss, 0.01));
}

function signalMeta(plan: HistoricalRecommendationPlan, horizon: HorizonId) {
  const score = planScore(plan);
  const threshold = HORIZON_THRESHOLDS[horizon];

  if (isRecommendedPlan(plan) && score >= threshold) {
    return {
      id: "buy" as const,
      label: "Buy",
      tone: "success" as UiTone
    };
  }

  if (score >= threshold - 8) {
    return {
      id: "watch" as const,
      label: "Wait",
      tone: "warning" as UiTone
    };
  }

  return {
    id: "avoid" as const,
    label: "Avoid",
    tone: "danger" as UiTone
  };
}

function outcomeMeta(plan: HistoricalRecommendationPlan) {
  const tone = outcomeClass(plan.outcome.result) as UiTone;

  return {
    tone,
    label: outcomeLabel(plan.outcome.result)
  };
}

function performanceMeta(successRate: number | null) {
  if (successRate === null) {
    return {
      tone: "neutral" as UiTone,
      shortLabel: "Pending",
      longLabel: "Pending"
    };
  }

  if (successRate >= 60) {
    return {
      tone: "success" as UiTone,
      shortLabel: `${successRate.toFixed(0)}% - Profitable`,
      longLabel: "Profitable"
    };
  }

  if (successRate < 40) {
    return {
      tone: "danger" as UiTone,
      shortLabel: `${successRate.toFixed(0)}% - Loss-making`,
      longLabel: "Loss-making"
    };
  }

  return {
    tone: "warning" as UiTone,
    shortLabel: `${successRate.toFixed(0)}% - Neutral`,
    longLabel: "Neutral"
  };
}

function scoreFilterMatches(score: number | undefined, filter: ScoreFilter) {
  const numericScore = score ?? 0;

  switch (filter) {
    case "60_plus":
      return numericScore >= 60;
    case "50_59":
      return numericScore >= 50 && numericScore < 60;
    case "below_50":
      return numericScore < 50;
    default:
      return true;
  }
}

function confidenceBucket(plan: HistoricalRecommendationPlan, horizon: HorizonId) {
  const threshold = HORIZON_THRESHOLDS[horizon];
  const score = planScore(plan);

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

function maxDrawdown(entries: ArchiveEntry[]) {
  const chronologicalReturns = [...entries]
    .filter((entry) => entry.plan.outcome.result !== "open")
    .sort((left, right) => left.batchDate.localeCompare(right.batchDate));

  if (!chronologicalReturns.length) {
    return null;
  }

  let equity = 100;
  let peak = 100;
  let worstDrawdown = 0;

  for (const entry of chronologicalReturns) {
    equity *= 1 + entry.plan.outcome.returnPct / 100;
    peak = Math.max(peak, equity);
    worstDrawdown = Math.max(worstDrawdown, ((peak - equity) / peak) * 100);
  }

  return roundMetric(worstDrawdown);
}

function average(values: Array<number | null>) {
  const resolved = values.filter((value): value is number => value !== null);

  if (!resolved.length) {
    return null;
  }

  return roundMetric(resolved.reduce((total, value) => total + value, 0) / resolved.length);
}

function insightTrend(rows: DailyPerformance[]) {
  const completed = rows.filter((row) => row.successRate !== null);
  const recent = completed.slice(0, 5);
  const previous = completed.slice(5, 10);
  const recentAverage = average(recent.map((row) => row.successRate));
  const previousAverage = average(previous.map((row) => row.successRate));

  if (recentAverage !== null && previousAverage !== null) {
    const delta = roundMetric(recentAverage - previousAverage);

    if (delta <= -5) {
      return {
        tone: "danger" as UiTone,
        title: "Win rate is softening",
        detail: `${Math.abs(delta).toFixed(1)} pts lower over the last 5 sessions than the prior 5.`
      };
    }

    if (delta >= 5) {
      return {
        tone: "success" as UiTone,
        title: "Win rate is improving",
        detail: `${delta.toFixed(1)} pts better over the last 5 sessions than the prior 5.`
      };
    }
  }

  if (completed[0]?.successRate !== null && completed[0]?.successRate !== undefined) {
    const meta = performanceMeta(completed[0].successRate);

    return {
      tone: meta.tone,
      title: "Latest batch check",
      detail: `${meta.shortLabel} on ${formatDate(completed[0].batchDate)}.`
    };
  }

  return {
    tone: "neutral" as UiTone,
    title: "Awaiting more closed outcomes",
    detail: "Historical calls are present, but more completed trades are needed for a stronger trend read."
  };
}

function confidenceInsight(entries: ArchiveEntry[], horizon: HorizonId) {
  const closedEntries = entries.filter((entry) => entry.plan.outcome.result !== "open");
  const buckets = Array.from(
    closedEntries.reduce((map, entry) => {
      const bucket = confidenceBucket(entry.plan, horizon);
      const current = map.get(bucket) ?? { total: 0, wins: 0 };

      current.total += 1;
      current.wins += entry.plan.outcome.result === "target_hit" ? 1 : 0;
      map.set(bucket, current);
      return map;
    }, new Map<string, { total: number; wins: number }>())
  )
    .map(([label, stats]) => ({
      label,
      total: stats.total,
      successRate: stats.total ? roundMetric((stats.wins / stats.total) * 100) : null
    }))
    .filter((item) => item.total >= 2 && item.successRate !== null)
    .sort((left, right) => (right.successRate ?? 0) - (left.successRate ?? 0));

  const best = buckets[0];
  const worst = buckets.at(-1);

  if (best && worst && best.label !== worst.label) {
    return {
      tone: (best.successRate ?? 0) >= 60 ? ("success" as UiTone) : ("warning" as UiTone),
      title: "Confidence correlates with outcomes",
      detail: `${best.label} setups are at ${(best.successRate ?? 0).toFixed(1)}% success versus ${(worst.successRate ?? 0).toFixed(1)}% for ${worst.label.toLowerCase()}.`
    };
  }

  if (best) {
    return {
      tone: "success" as UiTone,
      title: "Best performing setup band",
      detail: `${best.label} setups are converting at ${(best.successRate ?? 0).toFixed(1)}% across ${best.total} closed trades.`
    };
  }

  return {
    tone: "neutral" as UiTone,
    title: "Confidence correlation is still forming",
    detail: "There are not enough closed outcomes yet to compare score bands reliably."
  };
}

function sortRows(rows: DailyPerformance[], sortKey: SortKey, direction: SortDirection) {
  const sorted = [...rows];
  const multiplier = direction === "asc" ? 1 : -1;

  sorted.sort((left, right) => {
    if (sortKey === "date") {
      return left.batchDate.localeCompare(right.batchDate) * multiplier;
    }

    if (sortKey === "successRate") {
      return ((left.successRate ?? -1) - (right.successRate ?? -1)) * multiplier;
    }

    return (left.total - right.total) * multiplier;
  });

  return sorted;
}

function compareEntries(left: ArchiveEntry, right: ArchiveEntry) {
  const signalRank = { buy: 0, watch: 1, avoid: 2 };
  const signalDifference = signalRank[left.signal.id] - signalRank[right.signal.id];

  if (signalDifference !== 0) {
    return signalDifference;
  }

  const scoreDifference = planScore(right.plan) - planScore(left.plan);

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return left.stock.symbol.localeCompare(right.stock.symbol);
}

function toggleSort(currentKey: SortKey, currentDirection: SortDirection, nextKey: SortKey) {
  if (currentKey === nextKey) {
    return currentDirection === "desc" ? "asc" : "desc";
  }

  return nextKey === "date" ? "desc" : "desc";
}

function kpiTone(value: number | null, goodThreshold: number, weakThreshold: number) {
  if (value === null) {
    return "neutral" as UiTone;
  }

  if (value >= goodThreshold) {
    return "success" as UiTone;
  }

  if (value <= weakThreshold) {
    return "danger" as UiTone;
  }

  return "warning" as UiTone;
}

function trendArrow(current: number | null, baseline: number | null) {
  if (current === null || baseline === null) {
    return "->";
  }

  if (current > baseline) {
    return "↑";
  }

  if (current < baseline) {
    return "↓";
  }

  return "->";
}

export function HistoryDashboard({ data }: HistoryDashboardProps) {
  const [activeHorizon, setActiveHorizon] = useState<HorizonId>(data.profiles[0]?.id ?? "single_day");
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>("10");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedHistoryBatchDate, setSelectedHistoryBatchDate] = useState<string>(
    data.history[0]?.batchDate ?? ""
  );

  useEffect(() => {
    if (!data.profiles.some((profile) => profile.id === activeHorizon)) {
      setActiveHorizon(data.profiles[0]?.id ?? "single_day");
    }
  }, [activeHorizon, data.profiles]);

  const historyByDate = useMemo(
    () => [...data.history].sort((left, right) => right.batchDate.localeCompare(left.batchDate)),
    [data.history]
  );

  const visibleHistory = useMemo(() => {
    const limit = rangeLimit(rangeFilter);
    return limit === null ? historyByDate : historyByDate.slice(0, limit);
  }, [historyByDate, rangeFilter]);

  useEffect(() => {
    if (!visibleHistory.some((batch) => batch.batchDate === selectedHistoryBatchDate)) {
      setSelectedHistoryBatchDate(visibleHistory[0]?.batchDate ?? "");
    }
  }, [selectedHistoryBatchDate, visibleHistory]);

  const activeProfile = data.profiles.find((profile) => profile.id === activeHorizon) ?? data.profiles[0];
  const dailyPerformance = useMemo(
    () => buildDailyPerformance(visibleHistory, activeHorizon),
    [activeHorizon, visibleHistory]
  );
  const performanceSummary = useMemo(
    () => buildPerformanceSummary(dailyPerformance),
    [dailyPerformance]
  );

  const sortedPerformance = useMemo(
    () => sortRows(dailyPerformance, sortKey, sortDirection),
    [dailyPerformance, sortDirection, sortKey]
  );

  const selectedHistoryBatch =
    visibleHistory.find((batch) => batch.batchDate === selectedHistoryBatchDate) ?? visibleHistory[0] ?? null;
  const selectedPerformanceRow =
    dailyPerformance.find((row) => row.batchDate === selectedHistoryBatchDate) ?? dailyPerformance[0] ?? null;

  const rangeEntries = useMemo<ArchiveEntry[]>(
    () =>
      visibleHistory.flatMap((batch) =>
        batch.recommendations.map((stock) => {
          const plan = stock.profiles[activeHorizon];

          return {
            batchDate: batch.batchDate,
            publishedAt: batch.publishedAt,
            stock,
            plan,
            riskReward: planRiskReward(plan),
            signal: signalMeta(plan, activeHorizon)
          };
        })
      ),
    [activeHorizon, visibleHistory]
  );

  const analyzedTradeCount = rangeEntries.length;
  const publishedEntries = rangeEntries.filter((entry) => isRecommendedPlan(entry.plan));
  const publishedClosedEntries = publishedEntries.filter((entry) => entry.plan.outcome.result !== "open");
  const totalPublishedTrades = publishedEntries.length;
  const historicalAccuracy = publishedClosedEntries.length
    ? roundMetric(
        (publishedClosedEntries.filter((entry) => entry.plan.outcome.result === "target_hit").length /
          publishedClosedEntries.length) *
          100
      )
    : null;
  const maxHistoricalDrawdown = maxDrawdown(publishedEntries);

  const selectedBatchEntries = useMemo<ArchiveEntry[]>(() => {
    if (!selectedHistoryBatch) {
      return [];
    }

    return selectedHistoryBatch.recommendations
      .map((stock) => {
        const plan = stock.profiles[activeHorizon];

        return {
          batchDate: selectedHistoryBatch.batchDate,
          publishedAt: selectedHistoryBatch.publishedAt,
          stock,
          plan,
          riskReward: planRiskReward(plan),
          signal: signalMeta(plan, activeHorizon)
        };
      })
      .filter((entry) => (signalFilter === "all" ? true : entry.signal.id === signalFilter))
      .filter((entry) => scoreFilterMatches(entry.plan.score, scoreFilter))
      .sort(compareEntries);
  }, [activeHorizon, scoreFilter, selectedHistoryBatch, signalFilter]);

  const topInsight = useMemo(() => insightTrend(dailyPerformance), [dailyPerformance]);
  const confidenceCorrelation = useMemo(
    () => confidenceInsight(rangeEntries, activeHorizon),
    [activeHorizon, rangeEntries]
  );

  const comparativeSignals = useMemo(() => {
    const grouped = Array.from(
      rangeEntries
        .filter((entry) => entry.plan.outcome.result !== "open")
        .reduce((map, entry) => {
          const current = map.get(entry.signal.id) ?? {
            label: entry.signal.label,
            tone: entry.signal.tone,
            total: 0,
            wins: 0
          };

          current.total += 1;
          current.wins += entry.plan.outcome.result === "target_hit" ? 1 : 0;
          map.set(entry.signal.id, current);
          return map;
        }, new Map<string, { label: string; tone: UiTone; total: number; wins: number }>())
    )
      .map(([id, stats]) => ({
        id,
        label: stats.label,
        tone: stats.tone,
        total: stats.total,
        successRate: stats.total ? roundMetric((stats.wins / stats.total) * 100) : null
      }))
      .filter((item) => item.total >= 2 && item.successRate !== null)
      .sort((left, right) => (right.successRate ?? 0) - (left.successRate ?? 0));

    return {
      best: grouped[0] ?? null,
      worst: grouped.at(-1) ?? null
    };
  }, [rangeEntries]);

  const contextItems = [
    { label: "Exchange", value: data.exchange },
    { label: "Horizon", value: activeProfile?.label ?? "n/a" },
    { label: "Time range", value: rangeLabel(rangeFilter, visibleHistory.length) },
    { label: "Data source", value: data.dataSource?.provider ?? "Stored archive snapshot" },
    { label: "Last updated", value: formatDateTime(data.currentBatch.generatedAt) }
  ];

  const kpiCards = [
    {
      label: "Success rate",
      value: formatPercent(historicalAccuracy),
      footnote: `${trendArrow(historicalAccuracy, performanceSummary.averageSuccessRate)} vs archive average ${formatPercent(performanceSummary.averageSuccessRate)}`,
      tone: kpiTone(historicalAccuracy, 60, 40)
    },
    {
      label: "Avg return",
      value: formatPercent(performanceSummary.averageClosedReturnPct),
      footnote: `${trendArrow(performanceSummary.averageClosedReturnPct, 0)} closed-trade average`,
      tone: kpiTone(performanceSummary.averageClosedReturnPct, 2, -1)
    },
    {
      label: "Total trades",
      value: formatNumber(totalPublishedTrades),
      footnote: `${formatNumber(analyzedTradeCount)} analyzed setups`,
      tone: totalPublishedTrades > 0 ? ("success" as UiTone) : ("neutral" as UiTone)
    },
    {
      label: "Max drawdown",
      value: formatPercent(maxHistoricalDrawdown),
      footnote: maxHistoricalDrawdown !== null ? "Lower is better" : "Awaiting more closed trades",
      tone:
        maxHistoricalDrawdown === null
          ? ("neutral" as UiTone)
          : maxHistoricalDrawdown <= 6
            ? ("success" as UiTone)
            : maxHistoricalDrawdown >= 12
              ? ("danger" as UiTone)
              : ("warning" as UiTone)
    }
  ];

  return (
    <main className="shell archive-dashboard-shell">
      <section className="card archive-purpose-card">
        <div className="archive-purpose-top">
          <div className="archive-purpose-copy">
            <span className="archive-kicker">Archive analytics</span>
            <h1>Analyze past performance and validate strategy</h1>
            <p>
              Review historical hit rate, recommendation quality, and outcome tracking to answer one
              question fast: is this system earning trust over time?
            </p>
          </div>

          <div className="page-links">
            <Link className="secondary-link" href="/">
              Back to dashboard
            </Link>
          </div>
        </div>

        <div className="archive-summary-strip">
          <article className={`archive-summary-card ${topInsight.tone}`}>
            <span className="archive-summary-label">Strategy trend</span>
            <strong>{topInsight.title}</strong>
            <p>{topInsight.detail}</p>
          </article>
          <article className={`archive-summary-card ${confidenceCorrelation.tone}`}>
            <span className="archive-summary-label">Confidence signal</span>
            <strong>{confidenceCorrelation.title}</strong>
            <p>{confidenceCorrelation.detail}</p>
          </article>
        </div>
      </section>

      <section className="archive-context-bar" aria-label="Archive context">
        {contextItems.map((item) => (
          <div className="archive-context-item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="archive-control-strip">
        <div className="archive-pill-row" aria-label="Horizon selector">
          {data.profiles.map((profile) => (
            <button
              key={profile.id}
              className={`archive-pill${profile.id === activeHorizon ? " active" : ""}`}
              onClick={() => setActiveHorizon(profile.id)}
              type="button"
            >
              <span>{profile.label}</span>
              <small>{profile.window}</small>
            </button>
          ))}
        </div>

        <div className="archive-pill-row" aria-label="Date range selector">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`archive-chip${rangeFilter === option.id ? " active" : ""}`}
              onClick={() => setRangeFilter(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="archive-kpi-strip">
        {kpiCards.map((card) => (
          <article className={`archive-kpi-card ${card.tone}`} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.footnote}</small>
          </article>
        ))}
      </section>

      <section className="archive-comparison-strip">
        <article className="card archive-comparison-card">
          <span className="archive-kicker">Best performing setups</span>
          <h2>
            {comparativeSignals.best
              ? `${comparativeSignals.best.label} signals are leading`
              : "Best setup band is still forming"}
          </h2>
          <p>
            {comparativeSignals.best
              ? `${comparativeSignals.best.successRate?.toFixed(1)}% success across ${comparativeSignals.best.total} closed calls in the selected range.`
              : "More closed outcomes are needed before a best-performing signal group becomes reliable."}
          </p>
        </article>

        <article className="card archive-comparison-card">
          <span className="archive-kicker">Worst performing setups</span>
          <h2>
            {comparativeSignals.worst
              ? `${comparativeSignals.worst.label} signals need review`
              : "Weakest setup band is still forming"}
          </h2>
          <p>
            {comparativeSignals.worst
              ? `${comparativeSignals.worst.successRate?.toFixed(1)}% success across ${comparativeSignals.worst.total} closed calls, which makes it the weakest current pattern.`
              : "There are not enough closed outcomes yet to identify a consistently weak pattern."}
          </p>
        </article>

        <article className="card archive-comparison-card">
          <span className="archive-kicker">Trust markers</span>
          <h2>Transparency stays visible</h2>
          <p>
            {formatNumber(analyzedTradeCount)} analyzed setups, {formatPercent(historicalAccuracy)}
            {" "}historical accuracy, and score-versus-outcome context are always shown together so users can
            judge reliability instead of reading raw logs.
          </p>
        </article>
      </section>

      <section className="archive-main-grid">
        <section className="card archive-performance-panel">
          <div className="archive-panel-head">
            <div>
              <span className="archive-kicker">Daily scorecards</span>
              <h2>Compare sessions quickly</h2>
              <p>Select a date to update the recommendation panel on the right.</p>
            </div>
          </div>

          {sortedPerformance.length ? (
            <div className="archive-table-wrap">
              <table className="archive-performance-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        className="archive-sort-button"
                        onClick={() => {
                          setSortDirection(toggleSort(sortKey, sortDirection, "date"));
                          setSortKey("date");
                        }}
                        type="button"
                      >
                        Date
                      </button>
                    </th>
                    <th>
                      <button
                        className="archive-sort-button"
                        onClick={() => {
                          setSortDirection(toggleSort(sortKey, sortDirection, "successRate"));
                          setSortKey("successRate");
                        }}
                        type="button"
                      >
                        Success rate
                      </button>
                    </th>
                    <th>
                      <button
                        className="archive-sort-button"
                        onClick={() => {
                          setSortDirection(toggleSort(sortKey, sortDirection, "trades"));
                          setSortKey("trades");
                        }}
                        type="button"
                      >
                        Trades
                      </button>
                    </th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPerformance.map((row) => {
                    const meta = performanceMeta(row.successRate);
                    const isActive = row.batchDate === selectedHistoryBatchDate;

                    return (
                      <tr
                        key={row.batchDate}
                        className={`archive-performance-row ${meta.tone}${isActive ? " active" : ""}`}
                      >
                        <td>
                          <button
                            className="archive-row-button"
                            onClick={() => setSelectedHistoryBatchDate(row.batchDate)}
                            type="button"
                          >
                            <strong>{formatDate(row.batchDate)}</strong>
                            <span>{formatDateTime(row.publishedAt)}</span>
                          </button>
                        </td>
                        <td>
                          <div className="archive-cell-stack">
                            <strong>{formatPercent(row.successRate)}</strong>
                            <span>{formatPercent(row.averageReturnPct)} avg return</span>
                          </div>
                        </td>
                        <td>{formatNumber(row.total)}</td>
                        <td>{formatNumber(row.successful)}</td>
                        <td>{formatNumber(row.failed)}</td>
                        <td>
                          <span className={`archive-badge ${meta.tone}`}>{meta.shortLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No stored daily scorecards are available for this horizon yet." />
          )}
        </section>

        <aside className="card archive-detail-panel">
          <div className="archive-panel-head">
            <div>
              <span className="archive-kicker">Recommendation history</span>
              <h2>
                {selectedHistoryBatch
                  ? `${formatDate(selectedHistoryBatch.batchDate)} recommendations`
                  : "Recommendation details"}
              </h2>
              <p>
                {selectedPerformanceRow
                  ? `${performanceMeta(selectedPerformanceRow.successRate).shortLabel} · ${formatNumber(selectedPerformanceRow.total)} published trades`
                  : "Choose a trading day from the scorecard table to inspect its calls."}
              </p>
            </div>
          </div>

          <div className="archive-filter-row">
            <div className="archive-filter-group">
              <span>Signal type</span>
              <div className="archive-chip-row">
                {SIGNAL_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`archive-chip${signalFilter === option.id ? " active" : ""}`}
                    onClick={() => setSignalFilter(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="archive-filter-group">
              <span>Score range</span>
              <div className="archive-chip-row">
                {SCORE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`archive-chip${scoreFilter === option.id ? " active" : ""}`}
                    onClick={() => setScoreFilter(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="archive-detail-summary">
            <article className="archive-detail-stat">
              <span>Visible setups</span>
              <strong>{formatNumber(selectedBatchEntries.length)}</strong>
            </article>
            <article className="archive-detail-stat">
              <span>Published</span>
              <strong>
                {formatNumber(selectedBatchEntries.filter((entry) => isRecommendedPlan(entry.plan)).length)}
              </strong>
            </article>
            <article className="archive-detail-stat">
              <span>Selected horizon</span>
              <strong>{activeProfile?.label ?? "n/a"}</strong>
            </article>
          </div>

          {selectedBatchEntries.length ? (
            <div className="archive-detail-list">
              {selectedBatchEntries.map((entry) => {
                const outcome = outcomeMeta(entry.plan);

                return (
                  <article className="archive-setup-card" key={`${entry.batchDate}-${entry.stock.symbol}`}>
                    <div className="archive-setup-top">
                      <div>
                        <h3>{entry.stock.companyName}</h3>
                        <p>
                          {entry.stock.symbol} · {entry.stock.sector}
                        </p>
                      </div>

                      <div className="archive-setup-badges">
                        <span className={`archive-badge ${entry.signal.tone}`}>{entry.signal.label}</span>
                        <span className={`archive-badge ${outcome.tone}`}>{outcome.label}</span>
                      </div>
                    </div>

                    <div className="archive-setup-metrics">
                      <div>
                        <span>Entry</span>
                        <strong>{formatPrice(entry.plan.entryPrice)}</strong>
                      </div>
                      <div>
                        <span>Target</span>
                        <strong>{formatPrice(entry.plan.targetPrice)}</strong>
                      </div>
                      <div>
                        <span>Stop-loss</span>
                        <strong>{formatPrice(entry.plan.stopLoss)}</strong>
                      </div>
                      <div>
                        <span>Score</span>
                        <strong>{entry.plan.score?.toFixed(1) ?? "n/a"}</strong>
                      </div>
                      <div>
                        <span>Risk / Reward</span>
                        <strong>{entry.riskReward.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span>Outcome</span>
                        <strong>{entry.plan.outcome.returnPct.toFixed(2)}%</strong>
                      </div>
                    </div>

                    <div className="archive-setup-foot">
                      <p>{shorten(entry.plan.summary)}</p>
                      <Link className="archive-inline-link" href={`/stocks/${entry.stock.symbol}`}>
                        View details
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No archive recommendations match the current filters for this session." />
          )}
        </aside>
      </section>
    </main>
  );
}
