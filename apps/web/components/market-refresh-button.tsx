"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type RefreshTone = "neutral" | "success" | "error";
type RefreshJobState = "idle" | "running" | "succeeded" | "failed";

type RefreshApiResponse = {
  refreshed?: boolean;
  message?: string;
  error?: string;
  generatedAt?: string;
};

type RefreshStatusResponse = {
  scope: "all";
  state: RefreshJobState;
  phase: string;
  detail: string;
  percentComplete: number;
  percentRemaining: number;
  processedSymbols: number;
  totalSymbols: number;
  startedAt: string | null;
  finishedAt: string | null;
  generatedAt: string | null;
  error: string | null;
};

type MarketRefreshButtonProps = {
  buttonClassName?: string;
  containerClassName?: string;
  feedbackClassName?: string;
  hint?: string;
  idleLabel?: string;
  pendingLabel?: string;
};

const REFRESH_STATUS_POLL_MS = 1200;

const PHASE_LABELS: Record<string, string> = {
  ready: "Ready",
  preparing: "Preparing refresh",
  "loading-benchmark": "Loading benchmark",
  "refreshing-symbols": "Refreshing symbols",
  "scoring-models": "Scoring models",
  "persisting-snapshot": "Saving snapshot",
  complete: "Refresh complete",
  failed: "Refresh failed"
};

function phaseLabel(phase: string) {
  return (
    PHASE_LABELS[phase] ??
    phase
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function formatGeneratedAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
}

async function readRefreshStatus(signal?: AbortSignal) {
  const response = await fetch("/api/refresh-market-data", {
    method: "GET",
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    throw new Error("Unable to read refresh progress.");
  }

  return (await response.json()) as RefreshStatusResponse;
}

export function MarketRefreshButton({
  buttonClassName = "market-refresh-button",
  containerClassName = "market-refresh-control",
  feedbackClassName = "market-refresh-feedback",
  hint,
  idleLabel = "Refresh all data",
  pendingLabel = "Refreshing all data..."
}: MarketRefreshButtonProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<RefreshTone>("neutral");
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatusResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void readRefreshStatus(controller.signal)
      .then((status) => {
        setRefreshStatus(status);

        if (status.state === "running") {
          setIsRefreshing(true);
        }
      })
      .catch(() => {
        // Leave the button usable even if the status probe fails.
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isRefreshing) {
      return;
    }

    let active = true;
    const controller = new AbortController();
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        const status = await readRefreshStatus(controller.signal);

        if (!active) {
          return;
        }

        setRefreshStatus(status);

        if (status.state === "running") {
          timeoutId = window.setTimeout(poll, REFRESH_STATUS_POLL_MS);
          return;
        }

        setIsRefreshing(false);
      } catch {
        if (!active) {
          return;
        }

        timeoutId = window.setTimeout(poll, REFRESH_STATUS_POLL_MS);
      }
    };

    void poll();

    return () => {
      active = false;
      controller.abort();

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isRefreshing]);

  async function handleRefresh() {
    setIsRefreshing(true);
    setFeedback("Starting full market refresh...");
    setFeedbackTone("neutral");
    setRefreshStatus((current) =>
      current?.state === "running"
        ? current
        : {
            scope: "all",
            state: "running",
            phase: "preparing",
            detail: "Preparing a full market-data rebuild.",
            percentComplete: 1,
            percentRemaining: 99,
            processedSymbols: 0,
            totalSymbols: current?.totalSymbols ?? 0,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            generatedAt: null,
            error: null
          }
    );

    try {
      const response = await fetch("/api/refresh-market-data", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ scope: "all" })
      });
      const payload = (await response.json()) as RefreshApiResponse;
      const latestStatus = await readRefreshStatus().catch(() => null);

      if (latestStatus) {
        setRefreshStatus(latestStatus);
      }

      if (!response.ok || !payload.refreshed) {
        throw new Error(payload.error ?? payload.message ?? "Full market refresh failed.");
      }

      const generatedAtLabel = formatGeneratedAt(payload.generatedAt ?? latestStatus?.generatedAt);
      setFeedbackTone("success");
      setFeedback(
        generatedAtLabel
          ? `${payload.message ?? "Full market dataset refreshed successfully."} Updated at ${generatedAtLabel}.`
          : (payload.message ?? "Full market dataset refreshed successfully.")
      );
      router.refresh();
    } catch (error) {
      const latestStatus = await readRefreshStatus().catch(() => null);

      if (latestStatus) {
        setRefreshStatus(latestStatus);
      }

      setFeedbackTone("error");
      setFeedback(
        error instanceof Error
          ? error.message
          : "Full market refresh failed."
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  const runningStatus = refreshStatus?.state === "running" ? refreshStatus : null;
  const refreshProgressLabel = runningStatus
    ? `${runningStatus.percentComplete}% done · ${runningStatus.percentRemaining}% remaining`
    : null;
  const symbolProgressLabel =
    runningStatus && runningStatus.totalSymbols > 0
      ? runningStatus.processedSymbols < runningStatus.totalSymbols
        ? `${runningStatus.processedSymbols} of ${runningStatus.totalSymbols} symbols processed`
        : "All symbols refreshed. Final scoring and snapshot save are in progress."
      : null;

  return (
    <div className={containerClassName}>
      <button
        aria-busy={isRefreshing}
        className={`${buttonClassName}${isRefreshing ? " is-loading" : ""}`}
        disabled={isRefreshing}
        onClick={handleRefresh}
        type="button"
      >
        <span className="market-refresh-button-content">
          {isRefreshing ? <span aria-hidden="true" className="market-refresh-loader" /> : null}
          <span>{isRefreshing ? pendingLabel : idleLabel}</span>
        </span>
      </button>

      {hint ? <span className="market-refresh-hint">{hint}</span> : null}

      {runningStatus ? (
        <div className="market-refresh-status" aria-live="polite">
          <div className="market-refresh-status-row">
            <span className="market-refresh-phase">{phaseLabel(runningStatus.phase)}</span>
            <span className="market-refresh-metric">{refreshProgressLabel}</span>
          </div>
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={runningStatus.percentComplete}
            className="score-progress brand market-refresh-progress"
            role="progressbar"
          >
            <span style={{ width: `${runningStatus.percentComplete}%` }} />
          </div>
          <span className={`${feedbackClassName} neutral`}>{runningStatus.detail}</span>
          {symbolProgressLabel ? <span className="market-refresh-hint">{symbolProgressLabel}</span> : null}
        </div>
      ) : feedback ? (
        <span className={`${feedbackClassName} ${feedbackTone}`}>{feedback}</span>
      ) : null}
    </div>
  );
}
