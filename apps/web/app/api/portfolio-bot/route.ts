import { NextResponse } from "next/server";
import { listTradingReports, runPortfolioBotTick } from "@/lib/portfolio-bot";

export const dynamic = "force-dynamic";

type BotRequestBody = {
  action?: "tick" | "report";
};

export async function GET() {
  return NextResponse.json(
    {
      reports: await listTradingReports(10)
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function POST(request: Request) {
  let body: BotRequestBody = {};

  try {
    body = (await request.json()) as BotRequestBody;
  } catch {
    body = {};
  }

  const result = await runPortfolioBotTick({
    writeReport: body.action === "report"
  });

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
