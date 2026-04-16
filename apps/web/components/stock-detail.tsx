"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildStockPerformanceHistory } from "@/lib/analytics";
import {
  EmptyState,
  InfoTooltip,
  formatCrore,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPrice,
  isRecommendedPlan,
  normalizeSymbol,
  priceMoveMeta
} from "@/components/market-ui";
import { useLatestPriceOverlay } from "@/components/use-latest-price-overlay";
import type {
  AnalysisDriver,
  HorizonId,
  RecommendationPlan,
  RecommendationDataset,
  SearchAnalysisResult,
  Signal,
  StockAnalysis,
  StockPerformanceHistoryEntry
} from "@/lib/types";

type StockDetailProps = {
  data: RecommendationDataset;
  analysis: SearchAnalysisResult | null;
  requestedSymbol: string;
};

type UiTone = "success" | "warning" | "danger" | "neutral";
type TradeDecisionState = "buy" | "watch" | "avoid";
type AnalysisTabId = "technical" | "fundamental" | "sentiment" | "risk";

const HORIZON_THRESHOLDS: Record<HorizonId, number> = {
  single_day: 54,
  swing: 56,
  position: 58,
  long_term: 60
};

const TAB_INFO = {
  technical:
    "Technical analysis summarizes trend classification, breakout structure, RSI, MACD, Bollinger-band position, candlestick quality, and volume participation so you can judge whether buyers are actually in control.",
  fundamental:
    "Fundamental analysis summarizes sector context, business quality, growth, valuation, leverage, cash flow, and ownership support behind the setup.",
  sentiment:
    "Sentiment analysis combines news tone, earnings cues, and analyst commentary that can accelerate or weaken the move.",
  risk:
    "Risk analysis highlights fragility, volatility, stop-loss pressure, and payoff quality so you can judge whether the setup is worth taking."
} as const;

function defaultHorizon(data: RecommendationDataset, analysis: SearchAnalysisResult | null) {
  const preferred = analysis?.recommendedHorizons?.[0];

  if (preferred && data.profiles.some((profile) => profile.id === preferred)) {
    return preferred;
  }

  return data.profiles[0]?.id ?? "single_day";
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, value));
}

function firstSentence(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return "";
  }

  const match = cleaned.match(/.+?[.!?](?:\s|$)/);
  return (match?.[0] ?? cleaned).trim();
}

function shorten(text: string, maxLength = 156) {
  const normalized = firstSentence(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseNumericSignal(value: string) {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

function formatRatio(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(2)}x`;
}

function formatOptionalPercent(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function researchStateLabel(state?: "live" | "cached" | "unavailable") {
  switch (state) {
    case "live":
      return "Live";
    case "cached":
      return "Cached";
    case "unavailable":
      return "Unavailable";
    default:
      return "Unknown";
  }
}

function reasoningDriversFor(plan: RecommendationPlan, area: AnalysisDriver["area"]): AnalysisDriver[] {
  const explicitDrivers = plan.analysisDrivers?.filter((driver) => driver.area === area);

  if (explicitDrivers?.length) {
    return explicitDrivers;
  }

  return [
    {
      area,
      impact: "neutral",
      title: "Saved model rationale",
      detail:
        plan.drivers[0] ??
        "This saved snapshot predates the richer reasoning view. Use the trade setup and evidence signals until the next live batch refresh."
    }
  ];
}

function scoreInsight(score: number | undefined, horizon: HorizonId) {
  const threshold = HORIZON_THRESHOLDS[horizon];
  const safeScore = score ?? 0;

  if (score === undefined || !Number.isFinite(score)) {
    return {
      label: "Awaiting score",
      tone: "neutral" as UiTone,
      progress: 0,
      threshold
    };
  }

  if (safeScore >= threshold + 12) {
    return {
      label: "High Probability",
      tone: "success" as UiTone,
      progress: clampProgress(safeScore),
      threshold
    };
  }

  if (safeScore >= threshold) {
    return {
      label: "Tradable",
      tone: "success" as UiTone,
      progress: clampProgress(safeScore),
      threshold
    };
  }

  if (safeScore >= threshold - 8) {
    return {
      label: "Needs confirmation",
      tone: "warning" as UiTone,
      progress: clampProgress(safeScore),
      threshold
    };
  }

  return {
    label: "Avoid Trade",
    tone: "danger" as UiTone,
    progress: clampProgress(safeScore),
    threshold
  };
}

function tradeDecision(plan: RecommendationPlan, horizon: HorizonId) {
  const insight = scoreInsight(plan.score, horizon);

  if (isRecommendedPlan(plan) && insight.tone === "success") {
    return {
      state: "buy" as TradeDecisionState,
      label: insight.label === "High Probability" ? "Buy (High Probability)" : "Buy (Tradable)",
      note: insight.label,
      tone: "success" as UiTone,
      primaryAction: "Execute Trade"
    };
  }

  if (insight.label === "Needs confirmation" || plan.riskReward >= 1.2) {
    return {
      state: "watch" as TradeDecisionState,
      label: "Wait for confirmation",
      note: "Monitor only - not a buy yet",
      tone: "warning" as UiTone,
      primaryAction: "Track Setup"
    };
  }

  return {
    state: "avoid" as TradeDecisionState,
    label: "Avoid Trade",
    note: "Below trade threshold",
    tone: "danger" as UiTone,
    primaryAction: "View Detailed Analysis"
  };
}

function riskRewardInsight(riskReward: number) {
  if (riskReward >= 1.5) {
    return { label: "Good Risk/Reward", shortLabel: "Good", tone: "success" as UiTone };
  }

  if (riskReward >= 1) {
    return { label: "Balanced Risk/Reward", shortLabel: "Balanced", tone: "warning" as UiTone };
  }

  return { label: "Weak Risk/Reward", shortLabel: "Weak", tone: "danger" as UiTone };
}

function outcomeLabel(result: StockPerformanceHistoryEntry["outcome"]["result"]) {
  switch (result) {
    case "target_hit":
      return "Target hit";
    case "stop_loss_hit":
      return "Stop-loss hit";
    default:
      return "Open";
  }
}

function outcomeTone(result: StockPerformanceHistoryEntry["outcome"]["result"]) {
  switch (result) {
    case "target_hit":
      return "success" as UiTone;
    case "stop_loss_hit":
      return "danger" as UiTone;
    default:
      return "neutral" as UiTone;
  }
}

function impactLabel(impact: AnalysisDriver["impact"]) {
  switch (impact) {
    case "positive":
      return "Support";
    case "negative":
      return "Caution";
    default:
      return "Neutral";
  }
}

function impactTone(impact: AnalysisDriver["impact"]) {
  switch (impact) {
    case "positive":
      return "success" as UiTone;
    case "negative":
      return "danger" as UiTone;
    default:
      return "neutral" as UiTone;
  }
}

function insightLabelFromScore(value: string) {
  const numeric = parseNumericSignal(value);

  if (numeric === null) {
    return value;
  }

  if (numeric >= 70) {
    return "Strong";
  }

  if (numeric >= 55) {
    return "Supportive";
  }

  if (numeric >= 45) {
    return "Mixed";
  }

  return "Weak";
}

function signalValue(signals: Signal[] | undefined, name: string) {
  return signals?.find((signal) => signal.name === name)?.value ?? "n/a";
}

function ScoreMeter({
  progress,
  threshold,
  tone,
  label
}: {
  progress: number;
  threshold: number;
  tone: UiTone;
  label: string;
}) {
  return (
    <div className="trade-score-meter" aria-hidden="true">
      <div className="trade-score-track">
        <span className={`trade-score-fill ${tone}`} style={{ width: `${progress}%` }} />
        <span className="trade-score-threshold" style={{ left: `${threshold}%` }} />
      </div>
      <span className="trade-score-label">{label}</span>
    </div>
  );
}

export function StockDetail({ data, analysis, requestedSymbol }: StockDetailProps) {
  const fallbackStock = data.currentBatch.recommendations.find(
    (stock) => normalizeSymbol(stock.symbol) === normalizeSymbol(requestedSymbol)
  );
  const stock = (analysis?.stock ?? fallbackStock) as StockAnalysis | null;
  const [activeHorizon, setActiveHorizon] = useState<HorizonId>(() => defaultHorizon(data, analysis));
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<AnalysisTabId>("technical");
  const [isWatchlisted, setIsWatchlisted] = useState(false);
  const livePriceOverlay = useLatestPriceOverlay(stock ? [stock.symbol] : []);

  useEffect(() => {
    const nextDefault = defaultHorizon(data, analysis);

    if (!data.profiles.some((profile) => profile.id === activeHorizon)) {
      setActiveHorizon(nextDefault);
    }
  }, [activeHorizon, analysis, data.profiles]);

  useEffect(() => {
    setIsWatchlisted(false);
  }, [activeHorizon, stock?.symbol]);

  if (!stock) {
    return (
      <main className="shell">
        <section className="card masthead-card tone-risk">
          <div className="panel-banner">
            <div className="masthead-copy">
              <span className="section-eyebrow">Stock workspace</span>
              <h1>Stock not available</h1>
              <p>
                I could not build a stock detail page for <strong>{requestedSymbol.toUpperCase()}</strong>{" "}
                from the current live dataset.
              </p>
            </div>
            <div className="page-links">
              <Link className="secondary-link" href="/">
                Back to dashboard
              </Link>
            </div>
          </div>

          <EmptyState message={analysis?.message ?? "Try searching another NSE symbol from the dashboard."} />
        </section>
      </main>
    );
  }

  const activeProfile = data.profiles.find((profile) => profile.id === activeHorizon) ?? data.profiles[0];
  const selectedPlan = stock.profiles[activeHorizon];
  const selectedScore = selectedPlan.score;
  const liveCurrentPrice = livePriceOverlay[stock.symbol]?.currentMarketPrice ?? stock.currentMarketPrice;
  const liveDayStartPrice = livePriceOverlay[stock.symbol]?.dayStartPrice ?? null;
  const scoreMeta = scoreInsight(selectedScore, activeHorizon);
  const decision = tradeDecision(selectedPlan, activeHorizon);
  const riskRewardMeta = riskRewardInsight(selectedPlan.riskReward);
  const suggestionMove = priceMoveMeta(liveCurrentPrice, selectedPlan.entryPrice);
  const currentPriceMove = priceMoveMeta(liveCurrentPrice, liveDayStartPrice, "day start");
  const riskPerTradePct = Math.abs(((selectedPlan.entryPrice - selectedPlan.stopLoss) / selectedPlan.entryPrice) * 100);
  const activeProfileLabel = activeProfile?.label ?? "Selected";
  const thresholdLabel = `Threshold ${scoreMeta.threshold}`;

  const technicalDrivers = reasoningDriversFor(selectedPlan, "technical");
  const fundamentalDrivers = reasoningDriversFor(selectedPlan, "fundamental");
  const sentimentDrivers = reasoningDriversFor(selectedPlan, "sentiment");
  const earningsDrivers = reasoningDriversFor(selectedPlan, "earnings");
  const analystDrivers = reasoningDriversFor(selectedPlan, "analyst");
  const riskDrivers = reasoningDriversFor(selectedPlan, "risk");

  const stockHistory = useMemo<StockPerformanceHistoryEntry[]>(
    () => buildStockPerformanceHistory(data.history, stock.symbol, activeHorizon),
    [activeHorizon, data.history, stock.symbol]
  );

  const historySummary = useMemo(() => {
    const wins = stockHistory.filter((item) => item.outcome.result === "target_hit");
    const losses = stockHistory.filter((item) => item.outcome.result === "stop_loss_hit");
    const closed = [...wins, ...losses];
    const open = stockHistory.filter((item) => item.outcome.result === "open");
    const averageReturn = closed.length
      ? closed.reduce((total, item) => total + item.outcome.returnPct, 0) / closed.length
      : null;

    return {
      total: stockHistory.length,
      wins: wins.length,
      losses: losses.length,
      open: open.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : null,
      averageReturn
    };
  }, [stockHistory]);

  const analysisSummaryDrivers = [...technicalDrivers, ...fundamentalDrivers, ...sentimentDrivers, ...riskDrivers].slice(0, 4);

  const quickInsights = [
    {
      id: "technical" as AnalysisTabId,
      label: "Technical",
      value: insightLabelFromScore(signalValue(selectedPlan.technicalSignals, "Technical score")),
      tone: scoreMeta.tone,
      note: shorten(technicalDrivers[0]?.detail ?? selectedPlan.summary)
    },
    {
      id: "fundamental" as AnalysisTabId,
      label: "Fundamentals",
      value: insightLabelFromScore(signalValue(selectedPlan.fundamentalSignals, "Fundamental score")),
      tone:
        parseNumericSignal(signalValue(selectedPlan.fundamentalSignals, "Fundamental score")) !== null &&
        (parseNumericSignal(signalValue(selectedPlan.fundamentalSignals, "Fundamental score")) ?? 0) >= 55
          ? "success"
          : "warning",
      note: shorten(fundamentalDrivers[0]?.detail ?? "Business quality context is still mixed.")
    },
    {
      id: "sentiment" as AnalysisTabId,
      label: "Sentiment",
      value: signalValue(selectedPlan.sentimentSignals, "Overall tone"),
      tone:
        signalValue(selectedPlan.sentimentSignals, "Overall tone").toLowerCase() === "positive"
          ? "success"
          : signalValue(selectedPlan.sentimentSignals, "Overall tone").toLowerCase() === "negative"
            ? "danger"
            : "warning",
      note: shorten(sentimentDrivers[0]?.detail ?? earningsDrivers[0]?.detail ?? analystDrivers[0]?.detail ?? "")
    },
    {
      id: "risk" as AnalysisTabId,
      label: "Risk",
      value: riskRewardMeta.shortLabel,
      tone: riskRewardMeta.tone,
      note: shorten(riskDrivers[0]?.detail ?? "Risk controls are neutral.")
    }
  ];

  const horizonRows = data.profiles.map((profile) => {
    const plan = stock.profiles[profile.id];
    const rowDecision = tradeDecision(plan, profile.id);
    const rowScore = scoreInsight(plan.score, profile.id);
    const rowRiskReward = riskRewardInsight(plan.riskReward);

    return {
      profile,
      plan,
      rowDecision,
      rowScore,
      rowRiskReward
    };
  });

  const openAnalysisTab = (tab: AnalysisTabId) => {
    setActiveAnalysisTab(tab);

    if (typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById("analysis-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const selectHorizon = (horizon: HorizonId) => {
    setActiveHorizon(horizon);
  };

  const analysisTabs = [
    {
      id: "technical" as AnalysisTabId,
      title: "Technical",
      subtitle: "Trend classification, breakout structure, MACD, Bollinger bands, candles, and participation.",
      info: TAB_INFO.technical,
      signals: selectedPlan.technicalSignals.slice(0, 8),
      drivers: technicalDrivers
    },
    {
      id: "fundamental" as AnalysisTabId,
      title: "Fundamental",
      subtitle: "Business quality, growth, and profitability.",
      info: TAB_INFO.fundamental,
      signals: selectedPlan.fundamentalSignals.slice(0, 8),
      drivers: fundamentalDrivers
    },
    {
      id: "sentiment" as AnalysisTabId,
      title: "Sentiment",
      subtitle: "News tone, earnings cues, and analyst revisions.",
      info: TAB_INFO.sentiment,
      signals: [
        ...(selectedPlan.sentimentSignals ?? []),
        ...(selectedPlan.earningsSignals ?? []),
        ...(selectedPlan.analystSignals ?? [])
      ].slice(0, 10),
      drivers: [...sentimentDrivers, ...earningsDrivers, ...analystDrivers]
    },
    {
      id: "risk" as AnalysisTabId,
      title: "Risk",
      subtitle: "Volatility, fragility, and stop-loss pressure.",
      info: TAB_INFO.risk,
      signals: selectedPlan.riskSignals?.slice(0, 8) ?? [],
      drivers: riskDrivers
    }
  ];

  const activeTab = analysisTabs.find((tab) => tab.id === activeAnalysisTab) ?? analysisTabs[0];

  const primaryAction =
    decision.state === "buy"
      ? {
          kind: "link" as const,
          label: "Execute Trade",
          href: "#trade-plan"
        }
      : decision.state === "watch"
        ? {
            kind: "button" as const,
            label: isWatchlisted ? "Added to Watchlist" : "Add to Watchlist"
          }
        : {
            kind: "link" as const,
            label: "View Detailed Analysis",
            href: "#analysis-workspace"
          };

  return (
    <main className="shell trade-detail-shell">
      <div className="trade-detail-grid">
        <section className="trade-detail-main">
          <section className="card trade-command-card">
            <div className="trade-detail-toolbar">
              <div className="page-links">
                <Link className="secondary-link" href="/">
                  Dashboard
                </Link>
                <Link className="secondary-link" href="/history">
                  Archive
                </Link>
              </div>
            </div>

            <div className="trade-stock-line">
              <div>
                <span className="trade-detail-kicker">{activeProfileLabel} trade setup</span>
                <h1 className="trade-detail-title">{stock.companyName}</h1>
              </div>

              <div className="trade-stock-meta-line">
                <span className="trade-stock-meta-pill">{stock.symbol}</span>
                <span>{stock.sector}</span>
                {stock.industry ? <span>{stock.industry}</span> : null}
                <span>{stock.marketCapBucket}</span>
                <span>{stock.liquidityTier}</span>
              </div>
            </div>

            <div className="trade-command-strip">
              <div className="trade-command-price">
                <span className="trade-command-label">Current price</span>
                <strong>{formatPrice(liveCurrentPrice)}</strong>
                <span className={`trade-command-trend ${currentPriceMove.tone}`}>{currentPriceMove.move}</span>
                <span className="trade-command-note">{currentPriceMove.note}</span>
              </div>

              <div className={`trade-command-pill ${decision.tone}`}>
                <span className="trade-command-pill-label">Decision</span>
                <strong>{decision.label}</strong>
              </div>

              <div className={`trade-command-pill ${scoreMeta.tone}`}>
                <span className="trade-command-pill-label">Confidence</span>
                <strong>{scoreMeta.label}</strong>
              </div>

              <div className={`trade-command-pill ${riskRewardMeta.tone}`}>
                <span className="trade-command-pill-label">Risk / Reward</span>
                <strong>
                  {selectedPlan.riskReward.toFixed(2)} · {riskRewardMeta.shortLabel}
                </strong>
              </div>

              <div className="trade-command-actions">
                {primaryAction.kind === "link" ? (
                  <a className={`trade-primary-action ${decision.tone}`} href={primaryAction.href}>
                    {primaryAction.label}
                  </a>
                ) : (
                  <button
                    className={`trade-primary-action ${decision.tone}`}
                    onClick={() => setIsWatchlisted((current) => !current)}
                    type="button"
                  >
                    {primaryAction.label}
                  </button>
                )}

                <div className="trade-secondary-actions">
                  {decision.state !== "avoid" ? (
                    <a className="trade-secondary-action" href="#analysis-workspace">
                      View Detailed Analysis
                    </a>
                  ) : null}
                  {decision.state !== "watch" ? (
                    <button
                      className="trade-secondary-action"
                      onClick={() => setIsWatchlisted((current) => !current)}
                      type="button"
                    >
                      {isWatchlisted ? "Added to Watchlist" : "Add to Watchlist"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="trade-plan-strip" id="trade-plan">
              <article className="trade-plan-item entry">
                <span className="trade-plan-item-label">Suggested at</span>
                <strong>{formatPrice(selectedPlan.entryPrice)}</strong>
                <span className={`trade-command-trend ${suggestionMove.tone}`}>{suggestionMove.move}</span>
                <span className="trade-plan-item-note">{suggestionMove.note}</span>
              </article>
              <article className="trade-plan-item target">
                <span className="trade-plan-item-label">Target</span>
                <strong>{formatPrice(selectedPlan.targetPrice)}</strong>
              </article>
              <article className="trade-plan-item stop">
                <span className="trade-plan-item-label">Stop-loss</span>
                <strong>{formatPrice(selectedPlan.stopLoss)}</strong>
              </article>
              <article className={`trade-plan-item ${riskRewardMeta.tone}`}>
                <span className="trade-plan-item-label">Risk / Reward</span>
                <strong>
                  {selectedPlan.riskReward.toFixed(2)} · {riskRewardMeta.shortLabel}
                </strong>
              </article>
              <article className="trade-plan-item">
                <span className="trade-plan-item-label">Expected return</span>
                <strong>{selectedPlan.expectedReturnPct.toFixed(2)}%</strong>
              </article>
              <article className="trade-plan-item">
                <span className="trade-plan-item-label">Risk per trade</span>
                <strong>{riskPerTradePct.toFixed(2)}%</strong>
              </article>
            </div>

            <div className="trade-horizon-strip" role="tablist" aria-label="Trade horizon selector">
                  {data.profiles.map((profile) => (
                    <button
                      key={profile.id}
                      className={`trade-horizon-pill${profile.id === activeHorizon ? " active" : ""}`}
                      onClick={() => selectHorizon(profile.id)}
                      role="tab"
                      aria-selected={profile.id === activeHorizon}
                      type="button"
                >
                  <span>{profile.label}</span>
                  <small>{profile.window}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="card trade-insights-card">
            <div className="trade-section-head compact">
              <div>
                <span className="trade-section-kicker">Quick view</span>
                <h2>Key insights</h2>
              </div>
              <a className="trade-inline-link" href="#analysis-workspace">
                Expand for details
              </a>
            </div>

            <div className="trade-insight-chip-row">
              {quickInsights.map((chip) => (
                <button
                  key={chip.id}
                  className={`trade-insight-chip ${chip.tone}${activeAnalysisTab === chip.id ? " active" : ""}`}
                  onClick={() => openAnalysisTab(chip.id)}
                  type="button"
                >
                  <span className="trade-insight-chip-label">{chip.label}</span>
                  <strong>{chip.value}</strong>
                  <span className="trade-insight-chip-note">{chip.note}</span>
                </button>
              ))}
            </div>

            <ul className="trade-summary-list">
              {(analysis?.verdict ? [analysis.verdict] : [])
                .concat(analysisSummaryDrivers.map((driver) => `${driver.title}: ${driver.detail}`))
                .slice(0, 4)
                .map((item, index) => (
                  <li key={`${item}-${index}`}>{shorten(item, 150)}</li>
                ))}
            </ul>
          </section>

          <section className="card trade-horizon-card" id="cross-horizon">
            <div className="trade-section-head compact">
              <div>
                <span className="trade-section-kicker">Cross-horizon</span>
                <h2>Compare horizons instantly</h2>
              </div>
            </div>

            <div className="trade-horizon-table-wrap">
              <table className="trade-horizon-table">
                <thead>
                  <tr>
                    <th>Horizon</th>
                    <th>Decision</th>
                    <th>Score</th>
                    <th>Risk / Reward</th>
                  </tr>
                </thead>
                <tbody>
                  {horizonRows.map(({ profile, plan, rowDecision, rowScore, rowRiskReward }) => (
                    <tr key={profile.id} className={profile.id === activeHorizon ? "active" : ""}>
                      <td>
                        <button
                          className="trade-horizon-row-button"
                          onClick={() => selectHorizon(profile.id)}
                          type="button"
                        >
                          <strong>{profile.label}</strong>
                          <span>{profile.window}</span>
                        </button>
                      </td>
                      <td>
                        <span className={`trade-status-badge ${rowDecision.tone}`}>{rowDecision.label}</span>
                      </td>
                      <td>
                        <div className="trade-horizon-cell">
                          <strong>{plan.score?.toFixed(1) ?? "n/a"}</strong>
                          <span>{rowScore.label}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`trade-risk-pill ${rowRiskReward.tone}`}>
                          {plan.riskReward.toFixed(2)} · {rowRiskReward.shortLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card trade-analysis-card" id="analysis-workspace">
            <div className="trade-section-head">
              <div>
                <span className="trade-section-kicker">Detailed analysis</span>
                <h2>Evidence behind the trade</h2>
                <p className="trade-section-copy">
                  Review one analysis layer at a time. Use the quick chips above for fast navigation, then expand a tab when you want the deeper signal list.
                </p>
              </div>

              <div className="trade-analysis-tabs" role="tablist" aria-label="Analysis tabs">
                {analysisTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={`trade-analysis-tab${activeAnalysisTab === tab.id ? " active" : ""}`}
                    onClick={() => setActiveAnalysisTab(tab.id)}
                    role="tab"
                    aria-selected={activeAnalysisTab === tab.id}
                    type="button"
                  >
                    {tab.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="trade-analysis-panel">
              <div className="trade-analysis-panel-head">
                <div className="panel-title-heading">
                  <span className="trade-panel-title">{activeTab.title}</span>
                  <InfoTooltip label={`${activeTab.title} information`} content={activeTab.info} />
                </div>
                <p className="trade-section-copy">{activeTab.subtitle}</p>
              </div>

              <div className="trade-analysis-signal-grid">
                {activeTab.signals.slice(0, 6).map((signal) => (
                  <article className="trade-analysis-signal" key={`${activeTab.id}-${signal.name}`}>
                    <span>{signal.name}</span>
                    <strong>{signal.value}</strong>
                  </article>
                ))}
              </div>

              <div className="trade-analysis-brief-list">
                {activeTab.drivers.slice(0, 4).map((driver) => (
                  <article className={`trade-analysis-brief ${impactTone(driver.impact)}`} key={`${activeTab.id}-${driver.title}`}>
                    <div className="trade-analysis-brief-top">
                      <strong>{driver.title}</strong>
                      <span className={`trade-impact-badge ${impactTone(driver.impact)}`}>
                        {impactLabel(driver.impact)}
                      </span>
                    </div>
                    <p>{shorten(driver.detail, 170)}</p>
                  </article>
                ))}
              </div>

              <details className="trade-analysis-expand">
                <summary>Expand for details</summary>
                <div className="trade-analysis-expand-body">
                  <div className="trade-analysis-expand-grid">
                    {activeTab.signals.map((signal) => (
                      <article className="trade-analysis-detail" key={`${activeTab.id}-detail-${signal.name}`}>
                        <span>{signal.name}</span>
                        <strong>{signal.value}</strong>
                      </article>
                    ))}
                  </div>

                  {activeTab.id === "fundamental" && (stock.fundamentals || stock.researchStatus?.fundamentals) ? (
                    <div className="trade-analysis-extra-grid">
                      <article className="trade-analysis-detail">
                        <span>Sector</span>
                        <strong>{stock.sector}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Industry</span>
                        <strong>{stock.industry ?? stock.sector}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Fundamentals source</span>
                        <strong>{researchStateLabel(stock.researchStatus?.fundamentals.state)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Fundamentals status</span>
                        <strong>{stock.researchStatus?.fundamentals.detail ?? "No source detail available."}</strong>
                      </article>
                      {stock.researchStatus?.fundamentals ? (
                        <article className="trade-analysis-detail">
                          <span>Source checked</span>
                          <strong>{formatDateTime(stock.researchStatus.fundamentals.observedAt)}</strong>
                        </article>
                      ) : null}
                      {stock.fundamentals ? (
                        <>
                      <article className="trade-analysis-detail">
                        <span>Market cap</span>
                        <strong>{formatCrore(stock.fundamentals.marketCapCrore)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Revenue</span>
                        <strong>{formatCrore(stock.fundamentals.revenueCrore)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Profit</span>
                        <strong>{formatCrore(stock.fundamentals.profitCrore)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>P/E</span>
                        <strong>{formatRatio(stock.fundamentals.priceToEarnings)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>P/B</span>
                        <strong>{formatRatio(stock.fundamentals.priceToBook)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>ROE</span>
                        <strong>{formatOptionalPercent(stock.fundamentals.returnOnEquityPct)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>ROCE</span>
                        <strong>{formatOptionalPercent(stock.fundamentals.returnOnCapitalEmployedPct)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Debt / Equity</span>
                        <strong>{formatRatio(stock.fundamentals.debtToEquity)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>5Y sales growth</span>
                        <strong>{formatOptionalPercent(stock.fundamentals.salesGrowth5YPct)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Earnings growth</span>
                        <strong>{formatOptionalPercent(stock.fundamentals.earningsGrowthPct)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Operating cash flow</span>
                        <strong>{formatCrore(stock.fundamentals.operatingCashFlowCrore)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Free cash flow</span>
                        <strong>{formatCrore(stock.fundamentals.freeCashFlowCrore)}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Promoter holding</span>
                        <strong>{formatOptionalPercent(stock.fundamentals.promoterHoldingPct)}</strong>
                      </article>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {activeTab.id === "sentiment" && (stock.sentiment || stock.researchStatus?.sentiment) ? (
                    <>
                      <div className="trade-analysis-extra-grid">
                        <article className="trade-analysis-detail">
                          <span>Headline sources</span>
                          <strong>{researchStateLabel(stock.researchStatus?.sentiment.state)}</strong>
                        </article>
                        <article className="trade-analysis-detail">
                          <span>Headline status</span>
                          <strong>{stock.researchStatus?.sentiment.detail ?? "No source detail available."}</strong>
                        </article>
                        {stock.researchStatus?.sentiment ? (
                          <article className="trade-analysis-detail">
                            <span>Source checked</span>
                            <strong>{formatDateTime(stock.researchStatus.sentiment.observedAt)}</strong>
                          </article>
                        ) : null}
                        {stock.sentiment ? (
                          <>
                        <article className="trade-analysis-detail">
                          <span>Overall tone</span>
                          <strong>{stock.sentiment.overall}</strong>
                        </article>
                        <article className="trade-analysis-detail">
                          <span>Sentiment score</span>
                          <strong>{stock.sentiment.score.toFixed(1)}</strong>
                        </article>
                        <article className="trade-analysis-detail">
                          <span>Positive headlines</span>
                          <strong>{formatNumber(stock.sentiment.positiveCount)}</strong>
                        </article>
                        <article className="trade-analysis-detail">
                          <span>Negative headlines</span>
                          <strong>{formatNumber(stock.sentiment.negativeCount)}</strong>
                        </article>
                        <article className="trade-analysis-detail">
                          <span>NSE announcements</span>
                          <strong>{formatNumber(stock.sentiment.announcementCount)}</strong>
                        </article>
                          </>
                        ) : null}
                      </div>

                      {stock.sentiment?.headlines.length ? (
                        <div className="trade-headline-list">
                          {stock.sentiment.headlines.slice(0, 4).map((headline, index) => (
                            <article className="trade-headline-item" key={`${headline.title}-${index}`}>
                              <strong>{headline.title}</strong>
                              <span>
                                {headline.source} · {headline.category} · {headline.tone}
                                {headline.relevanceScore !== undefined
                                  ? ` · relevance ${headline.relevanceScore.toFixed(0)}`
                                  : ""}
                              </span>
                            </article>
                          ))}
                        </div>
                      ) : null}

                      {selectedPlan.newsContext.length ? (
                        <ul className="trade-context-list">
                          {selectedPlan.newsContext.slice(0, 4).map((item, index) => (
                            <li key={`${item}-${index}`}>{shorten(item, 140)}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}

                  {activeTab.id === "risk" && stockHistory.length ? (
                    <div className="trade-analysis-extra-grid">
                      <article className="trade-analysis-detail">
                        <span>Historical calls</span>
                        <strong>{historySummary.total}</strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Win rate</span>
                        <strong>
                          {historySummary.winRate !== null ? `${historySummary.winRate.toFixed(1)}%` : "Pending"}
                        </strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Average return</span>
                        <strong>
                          {historySummary.averageReturn !== null
                            ? `${historySummary.averageReturn.toFixed(2)}%`
                            : "Pending"}
                        </strong>
                      </article>
                      <article className="trade-analysis-detail">
                        <span>Open outcomes</span>
                        <strong>{historySummary.open}</strong>
                      </article>
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          </section>

          <section className="card trade-history-card">
            <div className="trade-section-head compact">
              <div>
                <span className="trade-section-kicker">Historical trust</span>
                <h2>How previous calls played out</h2>
              </div>
            </div>

            <div className="trade-history-metrics">
              <article className="trade-history-stat">
                <span>Win rate</span>
                <strong>{historySummary.winRate !== null ? `${historySummary.winRate.toFixed(1)}%` : "Pending"}</strong>
              </article>
              <article className="trade-history-stat">
                <span>Avg return</span>
                <strong>
                  {historySummary.averageReturn !== null ? `${historySummary.averageReturn.toFixed(2)}%` : "Pending"}
                </strong>
              </article>
              <article className="trade-history-stat">
                <span>Wins / losses</span>
                <strong>
                  {historySummary.wins} / {historySummary.losses}
                </strong>
              </article>
              <article className="trade-history-stat">
                <span>Recent outcomes</span>
                <strong>{historySummary.total}</strong>
              </article>
            </div>

            {stockHistory.length ? (
              <div className="trade-history-list">
                {stockHistory.slice(0, 4).map((item, index) => (
                  <article className={`trade-history-item ${outcomeTone(item.outcome.result)}`} key={`${item.batchDate}-${index}`}>
                    <div className="trade-history-item-top">
                      <div>
                        <span>{formatDate(item.batchDate)}</span>
                        <strong>{outcomeLabel(item.outcome.result)}</strong>
                      </div>
                      <span className={`trade-impact-badge ${outcomeTone(item.outcome.result)}`}>
                        {item.outcome.returnPct.toFixed(2)}%
                      </span>
                    </div>
                    <p>{shorten(item.outcome.notes, 150)}</p>
                    <div className="trade-history-item-meta">
                      <span>Entry {formatPrice(item.entryPrice)}</span>
                      <span>Target {formatPrice(item.targetPrice)}</span>
                      <span>Stop {formatPrice(item.stopLoss)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState message="This stock does not yet have stored historical outcomes for the selected horizon." />
            )}
          </section>
        </section>

        <aside className="trade-summary-rail">
          <section className="card trade-summary-card">
            <span className="trade-detail-kicker">Sticky summary</span>
            <h2>{decision.label}</h2>
            <div className="trade-summary-price">
              <div className="trade-summary-price-stack">
                <strong>{formatPrice(liveCurrentPrice)}</strong>
                <span className="trade-command-note">{currentPriceMove.note}</span>
              </div>
              <span className={`trade-command-trend ${currentPriceMove.tone}`}>{currentPriceMove.move}</span>
            </div>

            <ScoreMeter
              progress={scoreMeta.progress}
              threshold={scoreMeta.threshold}
              tone={scoreMeta.tone}
              label={`${selectedScore !== undefined ? `${selectedScore.toFixed(1)} / 100` : "n/a"} · ${thresholdLabel}`}
            />

            <div className="trade-summary-grid">
              <article className="trade-summary-tile">
                <span>Suggested at</span>
                <strong>{formatPrice(selectedPlan.entryPrice)}</strong>
                <span className={`trade-command-trend ${suggestionMove.tone}`}>{suggestionMove.move}</span>
                <span className="trade-command-note">{suggestionMove.note}</span>
              </article>
              <article className="trade-summary-tile target">
                <span>Target</span>
                <strong>{formatPrice(selectedPlan.targetPrice)}</strong>
              </article>
              <article className="trade-summary-tile stop">
                <span>Stop-loss</span>
                <strong>{formatPrice(selectedPlan.stopLoss)}</strong>
              </article>
              <article className={`trade-summary-tile ${riskRewardMeta.tone}`}>
                <span>Risk / Reward</span>
                <strong>
                  {selectedPlan.riskReward.toFixed(2)} · {riskRewardMeta.shortLabel}
                </strong>
              </article>
            </div>

            <div className="trade-summary-actions">
              {decision.state === "buy" ? (
                <a className={`trade-primary-action ${decision.tone}`} href="#trade-plan">
                  Execute Trade
                </a>
              ) : decision.state === "watch" ? (
                <button
                  className={`trade-primary-action ${decision.tone}`}
                  onClick={() => setIsWatchlisted((current) => !current)}
                  type="button"
                >
                  {isWatchlisted ? "Added to Watchlist" : "Add to Watchlist"}
                </button>
              ) : (
                <a className={`trade-primary-action ${decision.tone}`} href="#analysis-workspace">
                  View Detailed Analysis
                </a>
              )}

              {decision.state !== "avoid" ? (
                <a className="trade-secondary-action" href="#analysis-workspace">
                  View Detailed Analysis
                </a>
              ) : null}
              {decision.state !== "watch" ? (
                <button
                  className="trade-secondary-action"
                  onClick={() => setIsWatchlisted((current) => !current)}
                  type="button"
                >
                  {isWatchlisted ? "Added to Watchlist" : "Add to Watchlist"}
                </button>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
