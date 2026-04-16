import { NextResponse } from "next/server";
import { getRecommendationRefreshStatus, refreshRecommendationData } from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type RefreshRequestBody = {
  scope?: string;
};

export async function GET() {
  return NextResponse.json(getRecommendationRefreshStatus(), {
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

  const dataset = await refreshRecommendationData();

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
    dataSource: dataset.dataSource
  });
}
