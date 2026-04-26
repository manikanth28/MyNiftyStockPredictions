import { NextResponse } from "next/server";
import {
  getMarketRefreshReadiness,
  getRecommendationRefreshStatus,
  listAutomationRuns,
  recordSkippedRefreshRun,
  refreshRecommendationData
} from "@/lib/recommendation-data";
import type { AutomationRefreshTrigger } from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type RefreshRequestBody = {
  scope?: string;
  trigger?: AutomationRefreshTrigger;
  force?: boolean;
};

const REFRESH_TRIGGERS = new Set<AutomationRefreshTrigger>(["manual", "auto", "scheduler"]);

function normalizeRefreshTrigger(value: unknown): AutomationRefreshTrigger {
  return typeof value === "string" && REFRESH_TRIGGERS.has(value as AutomationRefreshTrigger)
    ? (value as AutomationRefreshTrigger)
    : "manual";
}

export async function GET() {
  const [readiness, automationRuns] = await Promise.all([
    getMarketRefreshReadiness(),
    listAutomationRuns(10)
  ]);

  return NextResponse.json({
    ...getRecommendationRefreshStatus(),
    readiness,
    automationRuns
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function POST(request: Request) {
  let body: RefreshRequestBody = {};

  try {
    body = (await request.json()) as RefreshRequestBody;
  } catch {
    body = {};
  }

  if (body.scope && body.scope !== "all") {
    return NextResponse.json(
      {
        refreshed: false,
        error: "Unsupported refresh scope. Use 'all' for a full market refresh."
      },
      { status: 400 }
    );
  }

  const trigger = normalizeRefreshTrigger(body.trigger);
  const force = body.force === true;
  const readiness = await getMarketRefreshReadiness();

  if (trigger === "scheduler" && !force && !readiness.shouldRefresh) {
    const run = await recordSkippedRefreshRun(trigger, readiness, readiness.detail, force);

    return NextResponse.json({
      refreshed: false,
      skipped: true,
      scope: "all",
      message: readiness.detail,
      readiness,
      run,
      automationRuns: await listAutomationRuns(10)
    }, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }

  const dataset = await refreshRecommendationData({
    trigger,
    force,
    readiness
  });

  if (!dataset) {
    return NextResponse.json(
      {
        refreshed: false,
        error:
          "Live market refresh failed. The existing cached snapshot is still available, but a fresh rebuild did not complete."
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    refreshed: true,
    scope: "all",
    message: "Full market dataset refreshed successfully.",
    generatedAt: dataset.currentBatch.generatedAt,
    batchDate: dataset.currentBatch.batchDate,
    dataSource: dataset.dataSource,
    readiness,
    automationRuns: await listAutomationRuns(10)
  });
}
