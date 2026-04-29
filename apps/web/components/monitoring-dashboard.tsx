import type { MonitoringSeverity, MonitoringSnapshot } from "@/lib/monitoring";

type MonitoringDashboardProps = {
  snapshot: MonitoringSnapshot;
};

function statusLabel(status: MonitoringSeverity) {
  switch (status) {
    case "ok":
      return "Healthy";
    case "warning":
      return "Needs attention";
    case "danger":
      return "Action required";
  }
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatNumber(value: number | null) {
  return value === null ? "n/a" : value.toLocaleString("en-IN");
}

function formatPercent(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function formatHours(value: number | null) {
  if (value === null) {
    return "n/a";
  }

  if (value < 1) {
    return "<1h";
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function runLabel(status: string) {
  return status.replace(/_/g, " ");
}

export function MonitoringDashboard({ snapshot }: MonitoringDashboardProps) {
  const latestRun = snapshot.automation.latestRun;

  return (
    <main className="shell monitoring-shell">
      <section className={`card monitoring-hero tone-technical monitoring-${snapshot.status}`}>
        <div>
          <span className={`monitoring-status-pill ${snapshot.status}`}>
            {statusLabel(snapshot.status)}
          </span>
          <h1>Automation and API monitoring</h1>
          <p>
            Read-only health surface for the recommendation API, daily market scan, cached fallback, source coverage,
            freshness checks, retry settings, and structured run events.
          </p>
        </div>

        <div className="monitoring-hero-meta">
          <article>
            <span>Current batch</span>
            <strong>{snapshot.freshness.currentBatchDate}</strong>
            <small>Expected {snapshot.freshness.expectedBatchDate}</small>
          </article>
          <article>
            <span>Source mode</span>
            <strong>{snapshot.dataSource?.mode ?? "unknown"}</strong>
            <small>{snapshot.dataSource?.provider ?? "No provider recorded"}</small>
          </article>
          <article>
            <span>Refresh state</span>
            <strong>{snapshot.refresh.state}</strong>
            <small>{snapshot.refresh.phase}</small>
          </article>
        </div>
      </section>

      <section className="monitoring-kpi-grid">
        <article className="card monitoring-kpi tone-overview">
          <span>Analyzed symbols</span>
          <strong>{formatNumber(snapshot.analyzedSymbols)}</strong>
          <small>{snapshot.dataSource?.detail ?? "No data-source detail recorded."}</small>
        </article>
        <article className="card monitoring-kpi tone-history">
          <span>Snapshot age</span>
          <strong>{formatHours(snapshot.freshness.generatedAgeHours)}</strong>
          <small>Generated {formatDateTime(snapshot.freshness.generatedAt)}</small>
        </article>
        <article className="card monitoring-kpi tone-risk">
          <span>Alerts</span>
          <strong>{snapshot.alerts.length}</strong>
          <small>{snapshot.alerts.length ? "Review the items below." : "No active monitoring alerts."}</small>
        </article>
        <article className="card monitoring-kpi tone-search">
          <span>Scheduler retry policy</span>
          <strong>{snapshot.automation.retryPolicy.retryCount} retries</strong>
          <small>
            Every {snapshot.automation.retryPolicy.intervalHours}h, delay{" "}
            {Math.round(snapshot.automation.retryPolicy.retryDelayMs / 1000)}s
          </small>
        </article>
      </section>

      <section className="monitoring-grid">
        <article className="card tone-fundamental">
          <div className="monitoring-section-title">
            <div>
              <span>Central source tracking</span>
              <h2>Source success and fallback health</h2>
            </div>
            <small>Counts come from refresh coverage when available, otherwise stock-level status.</small>
          </div>

          <div className="table-wrap">
            <table className="stock-table compact-table monitoring-table">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Live</th>
                  <th>Cached</th>
                  <th>Unavailable</th>
                  <th>Success</th>
                  <th>Providers</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sourceHealth.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <strong>{source.label}</strong>
                      <div className="monitoring-muted">{source.coverageSource}</div>
                    </td>
                    <td>{source.live}</td>
                    <td>{source.cached}</td>
                    <td>{source.unavailable}</td>
                    <td>{formatPercent(source.successRatePct)}</td>
                    <td>
                      {source.providers.length ? (
                        <div className="monitoring-provider-list">
                          {source.providers.map((provider) => (
                            <span key={`${source.id}-${provider.provider}`}>
                              {provider.provider} ({provider.count})
                            </span>
                          ))}
                        </div>
                      ) : (
                        "n/a"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card tone-technical">
          <div className="monitoring-section-title">
            <div>
              <span>Freshness checks</span>
              <h2>Dashboard market alignment</h2>
            </div>
          </div>

          <div className="monitoring-freshness">
            <div>
              <span>Expected batch date</span>
              <strong>{snapshot.freshness.expectedBatchDate}</strong>
            </div>
            <div>
              <span>Latest saved batch</span>
              <strong>{snapshot.freshness.latestBatchDate ?? "missing"}</strong>
            </div>
            <div>
              <span>Batch age</span>
              <strong>
                {snapshot.freshness.ageDays === null
                  ? "n/a"
                  : `${snapshot.freshness.ageDays} day${snapshot.freshness.ageDays === 1 ? "" : "s"}`}
              </strong>
            </div>
            <div>
              <span>Market session</span>
              <strong>{snapshot.freshness.isMarketSession ? "Open" : "Closed"}</strong>
            </div>
          </div>

          <p className="monitoring-note">{snapshot.freshness.detail}</p>
        </article>
      </section>

      <section className="monitoring-grid">
        <article className="card tone-risk">
          <div className="monitoring-section-title">
            <div>
              <span>Automation runs</span>
              <h2>Latest scheduler activity</h2>
            </div>
            <small>{latestRun ? `Last run ${formatDateTime(latestRun.startedAt)}` : "No runs recorded"}</small>
          </div>

          <div className="monitoring-run-list">
            {snapshot.automation.recentRuns.length ? (
              snapshot.automation.recentRuns.map((run) => (
                <article key={run.id} className={`monitoring-run ${run.status}`}>
                  <div>
                    <strong>{runLabel(run.status)}</strong>
                    <span>
                      {run.trigger} - {formatDateTime(run.startedAt)}
                    </span>
                  </div>
                  <p>{run.detail}</p>
                  <small>
                    Expected {run.expectedBatchDate ?? "n/a"} - Batch {run.batchDate ?? "n/a"} -{" "}
                    {run.processedSymbols}/{run.totalSymbols} symbols
                  </small>
                </article>
              ))
            ) : (
              <p className="monitoring-note">No automation runs have been recorded yet.</p>
            )}
          </div>
        </article>

        <article className="card tone-history">
          <div className="monitoring-section-title">
            <div>
              <span>Structured logs</span>
              <h2>Recent monitoring events</h2>
            </div>
            <small>Also available as JSON at /api/monitoring.</small>
          </div>

          <div className="monitoring-event-list">
            {snapshot.events.map((event) => (
              <article key={event.id} className={`monitoring-event ${event.severity}`}>
                <div>
                  <strong>{event.event}</strong>
                  <span>{formatDateTime(event.timestamp)}</span>
                </div>
                <p>{event.message}</p>
                <code>{JSON.stringify(event.fields)}</code>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="card tone-sentiment">
        <div className="monitoring-section-title">
          <div>
            <span>Alerts</span>
            <h2>Items needing attention</h2>
          </div>
        </div>

        <div className="monitoring-alert-grid">
          {snapshot.alerts.length ? (
            snapshot.alerts.map((alert) => (
              <article key={`${alert.title}-${alert.detail}`} className={`monitoring-alert ${alert.severity}`}>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
              </article>
            ))
          ) : (
            <article className="monitoring-alert ok">
              <strong>No active alerts</strong>
              <p>Freshness, refresh status, scheduler activity, and source coverage are currently healthy.</p>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}
