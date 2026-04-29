const DEFAULT_REFRESH_URL = "http://localhost:3000/api/refresh-market-data";
const refreshUrl = process.env.MARKET_REFRESH_URL || DEFAULT_REFRESH_URL;
const intervalHours = Number.parseFloat(process.env.MARKET_REFRESH_INTERVAL_HOURS || "0.5");
const retryCount = parsePositiveInteger(process.env.MARKET_REFRESH_RETRIES, 2);
const retryDelayMs = parsePositiveInteger(process.env.MARKET_REFRESH_RETRY_DELAY_MS, 15000);
const args = new Set(process.argv.slice(2));
const loop = args.has("--loop");
const force = args.has("--force");

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeStructuredLog(level, event, message, fields = {}) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    ...fields
  });

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function readStatus() {
  const startedAt = new Date().toISOString();
  console.log(`[market-scan] ${startedAt} GET ${refreshUrl}`);
  writeStructuredLog("info", "market_scan.readiness.started", "Reading market refresh readiness.", {
    refreshUrl
  });

  const response = await fetch(refreshUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Readiness check failed with HTTP ${response.status}.`);
  }

  writeStructuredLog("info", "market_scan.readiness.completed", "Market refresh readiness was read.", {
    shouldRefresh: payload.readiness?.shouldRefresh ?? null,
    expectedBatchDate: payload.readiness?.expectedBatchDate ?? null,
    latestBatchDate: payload.readiness?.latestBatchDate ?? null
  });

  return payload;
}

function logReadinessSkip(status) {
  const readiness = status.readiness ?? {};
  console.log(
    `[market-scan] skipped expected=${readiness.expectedBatchDate ?? "unknown"} latest=${readiness.latestBatchDate ?? "none"} reason=${readiness.detail ?? "refresh not required"}`
  );
  writeStructuredLog("info", "market_scan.readiness.skipped", readiness.detail ?? "Refresh not required.", {
    expectedBatchDate: readiness.expectedBatchDate ?? null,
    latestBatchDate: readiness.latestBatchDate ?? null
  });
}

async function postRefresh() {
  const startedAt = new Date().toISOString();
  console.log(`[market-scan] ${startedAt} POST ${refreshUrl}${force ? " --force" : ""}`);
  writeStructuredLog("info", "market_scan.refresh.started", "Posting scheduler refresh request.", {
    refreshUrl,
    force
  });

  const response = await fetch(refreshUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      scope: "all",
      trigger: "scheduler",
      force
    })
  });
  const payload = await readJson(response);

  if (payload.skipped) {
    console.log(`[market-scan] skipped reason=${payload.message || "refresh not required"}`);
    writeStructuredLog("info", "market_scan.refresh.skipped", payload.message || "Refresh not required.", {
      expectedBatchDate: payload.readiness?.expectedBatchDate ?? null,
      latestBatchDate: payload.readiness?.latestBatchDate ?? null
    });
    return payload;
  }

  if (!response.ok || payload.refreshed === false) {
    throw new Error(payload.error || payload.message || `Refresh failed with HTTP ${response.status}.`);
  }

  console.log(
    `[market-scan] refreshed batch=${payload.batchDate || "unknown"} generatedAt=${payload.generatedAt || "unknown"}`
  );
  writeStructuredLog("info", "market_scan.refresh.succeeded", "Scheduler refresh completed.", {
    batchDate: payload.batchDate ?? null,
    generatedAt: payload.generatedAt ?? null
  });

  return payload;
}

async function refreshOnce() {
  let status = null;

  try {
    status = await readStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[market-scan] readiness check unavailable: ${message}`);
    writeStructuredLog("warn", "market_scan.readiness.unavailable", "Readiness check failed before refresh.", {
      error: message
    });
  }

  if (!force && status?.readiness && !status.readiness.shouldRefresh) {
    logReadinessSkip(status);
  }

  return postRefresh();
}

async function refreshWithRetries() {
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await refreshOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (attempt >= retryCount) {
        throw error;
      }

      console.error(`[market-scan] attempt ${attempt + 1} failed: ${message}`);
      console.log(`[market-scan] retrying in ${Math.round(retryDelayMs / 1000)} second(s)`);
      writeStructuredLog("warn", "market_scan.retry.scheduled", "Refresh attempt failed; retry scheduled.", {
        attempt: attempt + 1,
        retryCount,
        retryDelayMs,
        error: message
      });
      await sleep(retryDelayMs);
    }
  }

  return null;
}

async function main() {
  if (!loop) {
    await refreshWithRetries();
    return;
  }

  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error("MARKET_REFRESH_INTERVAL_HOURS must be a positive number when using --loop.");
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;

  while (true) {
    try {
      await refreshWithRetries();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`[market-scan] ${message}`);
      writeStructuredLog("error", "market_scan.loop.failed", "Loop iteration failed after retries.", {
        error: message
      });
    }

    console.log(`[market-scan] sleeping ${intervalHours} hour(s)`);
    writeStructuredLog("info", "market_scan.loop.sleeping", "Scheduler loop is sleeping.", {
      intervalHours
    });
    await sleep(intervalMs);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[market-scan] ${message}`);
  writeStructuredLog("error", "market_scan.failed", "Market scan process failed.", {
    error: message
  });
  process.exitCode = 1;
});
