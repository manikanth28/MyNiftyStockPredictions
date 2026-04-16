import type {
  AnalysisDriver,
  DailyPerformance,
  HistoricalStockRecommendation,
  HorizonId,
  RecommendationPlan,
  Signal,
  StockPerformanceHistoryEntry
} from "@/lib/types";

export type AccentTone =
  | "brand"
  | "search"
  | "overview"
  | "technical"
  | "fundamental"
  | "sentiment"
  | "risk"
  | "history";

export type LatestPriceOverlayEntry = {
  currentMarketPrice: number;
  latestSessionChangePct: number | null;
  dayStartPrice: number | null;
  asOf: string | null;
};

export type LatestPriceOverlay = Record<string, LatestPriceOverlayEntry>;

export function formatPrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPriceDelta(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatPrice(Math.abs(value))}`;
}

export function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits
  }).format(value);
}

export function formatCrore(value: number | null) {
  if (value === null) {
    return "n/a";
  }

  return `${formatNumber(value)} Cr`;
}

export function formatPercent(value: number | null) {
  if (value === null) {
    return "Pending";
  }

  return `${value.toFixed(2)}%`;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN");
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN");
}

export function priceMoveMeta(
  currentPrice: number | null | undefined,
  referencePrice: number | null | undefined,
  contextLabel = "suggestion"
) {
  if (
    currentPrice === null ||
    currentPrice === undefined ||
    referencePrice === null ||
    referencePrice === undefined ||
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  ) {
    return {
      tone: "neutral" as const,
      label: "Move unavailable",
      move: "n/a",
      note: `Waiting for ${contextLabel} comparison`,
      deltaPct: null,
      deltaPrice: null
    };
  }

  const deltaPrice = currentPrice - referencePrice;
  const deltaPct = (deltaPrice / referencePrice) * 100;

  if (Math.abs(deltaPct) < 0.05) {
    return {
      tone: "neutral" as const,
      label: `Flat since ${contextLabel}`,
      move: "→ 0.00%",
      note: `${formatPriceDelta(0)} vs ${contextLabel}`,
      deltaPct: 0,
      deltaPrice: 0
    };
  }

  if (deltaPct > 0) {
    return {
      tone: "success" as const,
      label: `Up since ${contextLabel}`,
      move: `↑ +${deltaPct.toFixed(2)}%`,
      note: `${formatPriceDelta(deltaPrice)} vs ${contextLabel}`,
      deltaPct,
      deltaPrice
    };
  }

  return {
    tone: "danger" as const,
    label: `Down since ${contextLabel}`,
    move: `↓ ${Math.abs(deltaPct).toFixed(2)}%`,
    note: `${formatPriceDelta(deltaPrice)} vs ${contextLabel}`,
    deltaPct,
    deltaPrice
  };
}

export async function readLatestPriceOverlay(
  symbols: string[],
  signal?: AbortSignal
): Promise<LatestPriceOverlay> {
  const normalizedSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];

  if (!normalizedSymbols.length) {
    return {};
  }

  const response = await fetch("/api/recommendation-price-overlay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ symbols: normalizedSymbols }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Latest price overlay request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { prices?: LatestPriceOverlay };
  return payload.prices && typeof payload.prices === "object" ? payload.prices : {};
}

export function convictionClass(conviction: RecommendationPlan["conviction"]) {
  return conviction.toLowerCase();
}

export function isRecommendedPlan(plan: RecommendationPlan | { isRecommended?: boolean }) {
  return plan.isRecommended ?? true;
}

export function historyDecisionLabel(result: "target_hit" | "stop_loss_hit" | "open") {
  switch (result) {
    case "target_hit":
      return "Achieved";
    case "stop_loss_hit":
      return "Not achieved";
    default:
      return "Open";
  }
}

export function successRateTone(successRate: number | null) {
  if (successRate === null) {
    return "neutral";
  }

  if (successRate >= 60) {
    return "success";
  }

  if (successRate < 40) {
    return "danger";
  }

  return "neutral";
}

export function compactUniverseLabel(value: string) {
  return value.replace(/\s*\([^)]*\)\s*$/, "");
}

export function universeQualifier(value: string) {
  const match = value.match(/\(([^)]+)\)/);
  return match?.[1] ?? value;
}

export function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\.NS$/i, "");
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  tone = "brand"
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  tone?: AccentTone;
}) {
  return (
    <div className={`section-header tone-${tone}`}>
      <span className="section-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p className="section-copy">{subtitle}</p>
    </div>
  );
}

export function MetricTile({
  label,
  value,
  footnote
}: {
  label: string;
  value: string;
  footnote?: string;
}) {
  return (
    <article className="metric-tile">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {footnote ? <span className="metric-footnote">{footnote}</span> : null}
    </article>
  );
}

export function InfoTooltip({
  label,
  content
}: {
  label: string;
  content: string;
}) {
  return (
    <span className="info-tooltip" tabIndex={0}>
      <span aria-label={label} className="info-tooltip-trigger" role="img">
        i
      </span>
      <span className="info-tooltip-bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}

export function SignalSection({
  title,
  subtitle,
  signals,
  tone,
  info,
  signalActions
}: {
  title: string;
  subtitle: string;
  signals?: Signal[];
  tone: AccentTone;
  info?: string;
  signalActions?: Partial<Record<string, { hint?: string; onClick: () => void }>>;
}) {
  if (!signals?.length) {
    return null;
  }

  return (
    <section className={`card category-panel tone-${tone}`}>
      <div className="panel-title">
        <div className="panel-title-heading">
          <span className="panel-kicker">{title}</span>
          {info ? <InfoTooltip label={`${title} information`} content={info} /> : null}
        </div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="signal-tile-grid">
        {signals.map((signal) => {
          const action = signalActions?.[signal.name];

          if (action) {
            return (
              <button
                key={`${title}-${signal.name}`}
                className="signal-tile interactive"
                onClick={action.onClick}
                title={action.hint}
                type="button"
              >
                <span className="signal-name">{signal.name}</span>
                <strong>{signal.value}</strong>
                {action.hint ? <span className="metric-footnote">{action.hint}</span> : null}
              </button>
            );
          }

          return (
            <article key={`${title}-${signal.name}`} className="signal-tile">
              <span className="signal-name">{signal.name}</span>
              <strong>{signal.value}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function driverImpactLabel(impact: AnalysisDriver["impact"]) {
  switch (impact) {
    case "positive":
      return "Support";
    case "negative":
      return "Caution";
    default:
      return "Neutral";
  }
}

function driverImpactTone(impact: AnalysisDriver["impact"]) {
  switch (impact) {
    case "positive":
      return "success";
    case "negative":
      return "danger";
    default:
      return "neutral";
  }
}

export function ReasoningPanel({
  panelId,
  title,
  subtitle,
  drivers,
  tone,
  info,
  active = false
}: {
  panelId: string;
  title: string;
  subtitle: string;
  drivers?: AnalysisDriver[];
  tone: AccentTone;
  info?: string;
  active?: boolean;
}) {
  if (!drivers?.length) {
    return null;
  }

  return (
    <section className={`card category-panel tone-${tone} reasoning-panel${active ? " active" : ""}`} id={panelId}>
      <div className="panel-title">
        <div className="panel-title-heading">
          <span className="panel-kicker">{title}</span>
          {info ? <InfoTooltip label={`${title} information`} content={info} /> : null}
        </div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="reasoning-list">
        {drivers.map((driver) => (
          <article key={`${panelId}-${driver.title}`} className="reasoning-item">
            <div className="reasoning-item-top">
              <strong>{driver.title}</strong>
              <span className={`result-chip ${driverImpactTone(driver.impact)}`}>
                {driverImpactLabel(driver.impact)}
              </span>
            </div>
            <p>{driver.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

export function DailyPerformanceCard({ item }: { item: DailyPerformance }) {
  const tone = successRateTone(item.successRate);

  return (
    <article className={`performance-card ${tone}`}>
      <div className="performance-card-top">
        <div>
          <span className="panel-kicker">Trading day</span>
          <h3>{formatDate(item.batchDate)}</h3>
        </div>
        <span className={`result-chip ${tone}`}>
          {item.successRate === null
            ? "Pending"
            : item.successRate >= 60
              ? "Strong"
              : item.successRate < 40
                ? "Weak"
                : "Mixed"}
        </span>
      </div>

      <div className="mini-metric-grid">
        <MetricTile label="Success rate" value={formatPercent(item.successRate)} />
        <MetricTile label="Closed calls" value={String(item.closed)} />
        <MetricTile label="Winners" value={String(item.successful)} />
        <MetricTile label="Stops" value={String(item.failed)} />
      </div>
    </article>
  );
}

export function HistoryRecommendationCard({
  stock,
  activeHorizon
}: {
  stock: HistoricalStockRecommendation;
  activeHorizon: HorizonId;
}) {
  const plan = stock.profiles[activeHorizon];

  return (
    <article className="history-result-card">
      <div className="history-result-top">
        <div>
          <span className="panel-kicker">Recommendation</span>
          <h3>
            {stock.companyName} <span className="inline-meta">({stock.symbol})</span>
          </h3>
          <p>{stock.sector}</p>
        </div>
        <span className={`badge ${convictionClass(plan.conviction)}`}>{plan.conviction}</span>
      </div>

      <div className="mini-metric-grid">
        <MetricTile label="Entry" value={formatPrice(plan.entryPrice)} />
        <MetricTile label="Target" value={formatPrice(plan.targetPrice)} />
        <MetricTile label="Stop-loss" value={formatPrice(plan.stopLoss)} />
        <MetricTile label="Score" value={plan.score?.toFixed(1) ?? "n/a"} />
      </div>

      <p className="idea-summary">{plan.summary}</p>
    </article>
  );
}

export function StockOutcomeCard({ item }: { item: StockPerformanceHistoryEntry }) {
  return (
    <article className={`stock-outcome-card ${item.outcome.result}`}>
      <div className="history-result-top">
        <div>
          <span className="panel-kicker">Previous recommendation</span>
          <h3>
            {item.companyName} <span className="inline-meta">({item.symbol})</span>
          </h3>
          <p>
            {item.sector} · {formatDate(item.batchDate)}
          </p>
          <p>
            Entry {formatPrice(item.entryPrice)} · Target {formatPrice(item.targetPrice)} · Stop{" "}
            {formatPrice(item.stopLoss)}
          </p>
        </div>
        <span
          className={`result-chip ${
            item.outcome.result === "target_hit"
              ? "success"
              : item.outcome.result === "stop_loss_hit"
                ? "danger"
                : "neutral"
          }`}
        >
          {historyDecisionLabel(item.outcome.result)}
        </span>
      </div>

      <div className="mini-metric-grid">
        <MetricTile label="Outcome" value={`${item.outcome.returnPct.toFixed(2)}%`} />
        <MetricTile label="Holding days" value={String(item.outcome.holdingDays)} />
        <MetricTile
          label={item.outcome.result === "open" ? "Last evaluated" : "Exit date"}
          value={formatDate(item.outcome.evaluatedOn)}
        />
      </div>

      <p className="idea-summary">{item.outcome.notes}</p>
    </article>
  );
}
