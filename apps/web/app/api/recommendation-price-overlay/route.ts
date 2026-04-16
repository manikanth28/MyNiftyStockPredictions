import { NextResponse } from "next/server";
import { fetchLatestPriceOverlay } from "@/lib/recommendation-data";

export const dynamic = "force-dynamic";

type LatestPriceRequestBody = {
  symbols?: string[];
};

export async function POST(request: Request) {
  let body: LatestPriceRequestBody = {};

  try {
    body = (await request.json()) as LatestPriceRequestBody;
  } catch {
    body = {};
  }

  const symbols = Array.isArray(body.symbols)
    ? body.symbols.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (symbols.length > 25) {
    return NextResponse.json(
      {
        error: "Price sync is limited to 25 symbols per request."
      },
      { status: 400 }
    );
  }

  const prices = await fetchLatestPriceOverlay(symbols);

  return NextResponse.json({
    prices,
    syncedAt: new Date().toISOString()
  });
}
