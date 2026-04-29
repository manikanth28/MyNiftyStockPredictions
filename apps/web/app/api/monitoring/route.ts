import { NextResponse } from "next/server";
import { buildMonitoringSnapshot } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await buildMonitoringSnapshot(), {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "danger",
        error: error instanceof Error ? error.message : String(error),
        generatedAt: new Date().toISOString()
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
